import { Ajv, type ValidateFunction } from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolCall, ToolResult } from '../types';

export type ToolSchema = { type: 'object'; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; [key: string]: unknown };
export type ToolDefinition = { name: string; description: string; inputSchema: ToolSchema; effect: 'read' | 'write'; timeoutMs?: number; execute: (args: unknown, context: ToolContext) => Promise<unknown> };
export type ToolContext = { signal: AbortSignal; principal: string; invoke: (call: ToolCall) => Promise<ToolResult> };
export type ExecutionSession = { principal: string; signal: AbortSignal; remaining: number; maxDepth: number; approvedCalls: Set<string> };
type Entry = { definition: ToolDefinition; validate: ValidateFunction };

export async function callFingerprint(call: ToolCall): Promise<string> {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, stable(v)])) : value;
  const data = new TextEncoder().encode(JSON.stringify([call.name, stable(call.arguments)]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
}

/** Per-request execution limits are shared by nested calls. A tool failure is data, not a broken stream. */
export class MCPBus {
  private entries = new Map<string, Entry>();
  private ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  private clients: Client[] = [];
  register(definition: ToolDefinition): void {
    if (!/^[a-zA-Z][\w-]{0,63}$/.test(definition.name)) throw new Error('Invalid tool name');
    if (this.entries.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
    this.entries.set(definition.name, { definition, validate: this.ajv.compile(definition.inputSchema) });
  }
  list(names?: Set<string>) { return [...this.entries.values()].filter(e => !names || names.has(e.definition.name)).map(({ definition: d }) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema, effect: d.effect })); }
  modelTools(names?: Set<string>) { return this.list(names).map(d => ({ type: 'function' as const, function: { name: d.name, description: d.description, parameters: d.inputSchema } })); }

  async execute(call: ToolCall, session: ExecutionSession, depth = 0): Promise<ToolResult> {
    const failure = (code: string, message: string, retryable = false): ToolResult => ({ id: call.id, name: call.name, ok: false, error: { code, message, retryable } });
    if (session.signal.aborted) return failure('ABORTED', 'The task was stopped.');
    if (depth > session.maxDepth || session.remaining-- <= 0) return failure('BUDGET_EXHAUSTED', 'The tool execution limit has been reached.');
    const entry = this.entries.get(call.name); if (!entry) return failure('UNKNOWN_TOOL', 'Choose a tool from the available registry.');
    if (!entry.validate(call.arguments)) return failure('INVALID_ARGUMENTS', this.ajv.errorsText(entry.validate.errors).slice(0, 600));
    if (entry.definition.effect === 'write' && !session.approvedCalls.has(await callFingerprint(call))) return failure('APPROVAL_REQUIRED', 'This exact write needs user approval before execution.');
    const controller = new AbortController();
    const abort = () => controller.abort(session.signal.reason); session.signal.addEventListener('abort', abort, { once: true });
    const timeoutMs = Math.min(60_000, Math.max(100, entry.definition.timeoutMs ?? 12_000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, timeoutMs); });
      const result = await Promise.race([entry.definition.execute(call.arguments, { principal: session.principal, signal: controller.signal, invoke: child => this.execute(child, session, depth + 1) }), timeout]);
      const encoded = JSON.stringify(result ?? null);
      if (encoded.length > 80_000) return failure('RESULT_TOO_LARGE', 'Narrow the query or use pagination; the result exceeded 80 KB.');
      return { id: call.id, name: call.name, ok: true, value: JSON.parse(encoded) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (session.signal.aborted) return failure('ABORTED', 'The task was stopped.');
      if (message === 'TIMEOUT' || controller.signal.aborted) return failure('TIMEOUT', 'The tool timed out. Try a narrower query.', entry.definition.effect === 'read');
      // Raw provider exceptions can include auth headers or signed URLs.
      return failure('TOOL_FAILED', 'The integration could not complete this operation. Check its connection and request parameters.', false);
    } finally { if (timer) clearTimeout(timer); session.signal.removeEventListener('abort', abort); }
  }

  async executeBatch(calls: ToolCall[], session: ExecutionSession, concurrency = 4): Promise<ToolResult[]> {
    if (calls.length > 24) throw new Error('Too many tool calls in one step');
    const results: ToolResult[] = []; let cursor = 0;
    // Mutations are sequential; only vetted reads run concurrently.
    while (cursor < calls.length) {
      const call = calls[cursor];
      if (this.entries.get(call.name)?.definition.effect !== 'read') { results.push(await this.execute(call, session)); cursor++; continue; }
      const batch: ToolCall[] = [];
      while (cursor < calls.length && batch.length < Math.min(8, Math.max(1, concurrency)) && this.entries.get(calls[cursor].name)?.definition.effect === 'read') batch.push(calls[cursor++]);
      results.push(...await Promise.all(batch.map(c => this.execute(c, session))));
    }
    return results;
  }

  /** Endpoints and read classifications must come from the authenticated server configuration. */
  async connect(options: { namespace: string; endpoint: URL; headers?: Record<string, string>; readTools: Set<string>; allowedTools?: Set<string> }): Promise<number> {
    if (options.endpoint.protocol !== 'https:' || options.endpoint.username || options.endpoint.password) throw new Error('MCP requires a configured HTTPS endpoint');
    const client = new Client({ name: 'navisoul', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(options.endpoint, { requestInit: { headers: options.headers, redirect: 'error' } });
    try {
      await client.connect(transport, { timeout: 12_000 });
      let cursor: string | undefined; let total = 0;
      do {
        const listing = await client.listTools(cursor ? { cursor } : undefined, { timeout: 12_000 });
        for (const tool of listing.tools) {
          if (total >= 200) throw new Error('MCP registry limit exceeded');
          if (options.allowedTools && !options.allowedTools.has(tool.name)) continue;
          this.register({ name: `${options.namespace}_${tool.name}`, description: tool.description?.slice(0, 1000) ?? tool.name, inputSchema: tool.inputSchema as ToolSchema, effect: options.readTools.has(tool.name) ? 'read' : 'write', execute: async (args, context) => {
            const result = await client.callTool({ name: tool.name, arguments: args as Record<string, unknown> }, undefined, { signal: context.signal, timeout: 12_000 });
            if (result.isError) return { status: 'tool_error', content: result.content };
            return result;
          } }); total++;
        }
        cursor = listing.nextCursor;
      } while (cursor);
      this.clients.push(client); return total;
    } catch (error) { await client.close().catch(() => {}); throw error; }
  }
  async close(): Promise<void> { await Promise.allSettled(this.clients.map(client => client.close())); this.clients = []; }
}
