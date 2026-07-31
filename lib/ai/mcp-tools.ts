import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { callMcp, getMcpToolPolicy } from "../mcp";

/** Servers consulted per request, matching the metadata gatherer's budget. */
const MAX_SERVERS = 3;
/** Tool definitions all count against the prompt, so keep the surface small. */
const MAX_TOOLS = 24;
/** A tool result larger than this crowds out the conversation. */
const MAX_RESULT_CHARS = 24_000;

type McpToolDescriptor = {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/** MCP returns content blocks; flatten to something a model can read. */
function flattenResult(result: unknown): string {
  const blocks = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  const text = Array.isArray(blocks)
    ? blocks.map((block) => (typeof block.text === "string" ? block.text : `[${block.type ?? "content"}]`)).join("\n")
    : JSON.stringify(result);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n[Truncated — the connector returned more than ${MAX_RESULT_CHARS} characters.]`
    : text;
}

/**
 * Expose a connector's tools to the model so it can call them itself.
 *
 * Only tools that cannot write are bridged. A write needs the user's explicit
 * approval, and nothing here can ask for it mid-generation — that is what the
 * confirmation gate on /api/mcp/tools is for. Bridging writes without that
 * would let a model send mail or change a calendar on its own initiative.
 */
export async function buildMcpTools(
  serverIds: string[],
  signal?: AbortSignal,
  onActivity: (label: string) => void = () => {}
): Promise<ToolSet> {
  const policy = getMcpToolPolicy();
  const selected = serverIds.filter((id) => policy.has(id)).slice(0, MAX_SERVERS);
  if (!selected.length) return {};

  const perServer = await Promise.allSettled(
    selected.map(async (serverId) => {
      const listed = (await callMcp(serverId, "tools/list", {}, signal)) as { tools?: McpToolDescriptor[] };
      return { serverId, tools: Array.isArray(listed?.tools) ? listed.tools : [] };
    })
  );

  const tools: ToolSet = {};
  for (const settled of perServer) {
    if (settled.status !== "fulfilled") continue;
    const { serverId, tools: listed } = settled.value;

    for (const descriptor of listed) {
      const name = descriptor.name;
      if (typeof name !== "string" || !name) continue;
      if (policy.get(serverId)?.(name)) continue; // needs approval; not auto-callable
      if (Object.keys(tools).length >= MAX_TOOLS) break;

      // Namespaced so two connectors exposing "search" stay distinguishable.
      const key = `${serverId}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      tools[key] = dynamicTool({
        description: descriptor.description
          ? `${descriptor.description} (via the ${serverId} connector)`
          : `The ${name} tool on the ${serverId} connector.`,
        inputSchema: jsonSchema(
          (descriptor.inputSchema as Parameters<typeof jsonSchema>[0] | undefined)
            ?? { type: "object", properties: {}, additionalProperties: true }
        ),
        execute: async (input) => {
          onActivity(`Asking ${serverId} for ${name.replace(/_/g, " ")}`);
          try {
            const result = await callMcp(serverId, "tools/call", { name, arguments: input ?? {} }, signal);
            return flattenResult(result);
          } catch (error) {
            // Returned rather than thrown: the model can explain the failure or
            // try another route, where a throw would kill the whole response.
            return `The ${name} tool failed: ${error instanceof Error ? error.message : "unknown error"}`;
          }
        }
      });
    }
  }

  return tools;
}
