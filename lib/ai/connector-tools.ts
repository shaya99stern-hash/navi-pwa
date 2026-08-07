import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { CustomConnector } from "./types";
import { assertFetchableUrl } from "./web-tools";

/**
 * Tools for the connectors the user typed in themselves.
 *
 * Registry MCP servers are configured in the deployment; these are the ones
 * added from the phone on the Connectors screen. One tool covers them all —
 * the model names a connector and says what it wants — because a tool per
 * connector would spend the tool budget on schema for connectors this turn
 * will not touch.
 *
 * The credential rides in from the client with the request and dies with it.
 * The base URL passes the same private-address guard as fetch_url: a
 * connector is still a model-reachable URL aimed from our own network.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULT_CHARS = 8_000;
const MAX_ROWS = 50;

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[Truncated.]` : text;
}

/**
 * Fetch a connector endpoint with the SSRF posture stated in one place.
 *
 * The URL is re-validated here — https only, no private or link-local host —
 * even though callers build it from an already-validated base, so no future
 * call site can skip the check. Redirects are refused outright: a public
 * host that answers 302 toward an internal address is the classic way past
 * a hostname guard, and no connector API needs a redirect to work.
 */
async function timedFetch(url: string, init: RequestInit, outer?: AbortSignal): Promise<Response> {
  const target = assertFetchableUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward);
  try {
    return await fetch(target.toString(), { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

/** Ask an OpenAI- or Anthropic-compatible API and return its answer text. */
async function askAiConnector(connector: CustomConnector, prompt: string, signal?: AbortSignal): Promise<string> {
  const base = assertFetchableUrl(connector.baseUrl).toString().replace(/\/+$/, "");
  if (connector.kind === "anthropic") {
    const response = await timedFetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": connector.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: connector.model || "claude-haiku-4-5-20251001",
        max_tokens: 2_048,
        messages: [{ role: "user", content: prompt }]
      })
    }, signal);
    if (!response.ok) return `${connector.name} returned ${response.status}: ${clip(await response.text())}`;
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    return clip(text || "The connector answered with no text.");
  }

  const response = await timedFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${connector.apiKey}` },
    body: JSON.stringify({
      model: connector.model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    })
  }, signal);
  if (!response.ok) return `${connector.name} returned ${response.status}: ${clip(await response.text())}`;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return clip(data.choices?.[0]?.message?.content || "The connector answered with no text.");
}

/** Read rows from a Supabase project over PostgREST with the connector's key. */
async function querySupabaseConnector(connector: CustomConnector, table: string, select: string, limit: number, signal?: AbortSignal): Promise<string> {
  if (!/^[a-zA-Z0-9_]{1,80}$/.test(table)) return "That table name is not valid.";
  const base = assertFetchableUrl(connector.baseUrl).toString().replace(/\/+$/, "");
  const cappedLimit = Math.min(Math.max(1, limit), MAX_ROWS);
  const response = await timedFetch(
    `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${cappedLimit}`,
    { headers: { apikey: connector.apiKey, Authorization: `Bearer ${connector.apiKey}` } },
    signal
  );
  if (!response.ok) return `${connector.name} returned ${response.status}: ${clip(await response.text())}`;
  return clip(await response.text());
}

export function buildConnectorTools({ connectors, signal, onActivity = () => {} }: {
  connectors: CustomConnector[];
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
}): ToolSet {
  const usable = connectors.filter((connector) => connector.kind !== "mcp");
  if (!usable.length) return {};

  const roster = usable
    .map((connector) => `"${connector.name}" (${connector.kind === "supabase" ? "Supabase database" : "AI model API"})`)
    .join(", ");

  return {
    use_connector: tool({
      description: `Use one of the user's own connectors: ${roster}. For an AI connector, send it a prompt and get its answer — useful for delegating a subtask or getting a second model's view. For a Supabase connector, read rows from a table. Never invent connector names; only the ones listed exist.`,
      inputSchema: z.object({
        connector: z.string().describe("The connector's name, exactly as listed."),
        prompt: z.string().optional().describe("For AI connectors: what to ask."),
        table: z.string().optional().describe("For Supabase connectors: the table to read."),
        select: z.string().optional().describe("For Supabase connectors: columns to select, default *."),
        limit: z.number().optional().describe("For Supabase connectors: max rows, default 10.")
      }),
      execute: async ({ connector: name, prompt, table, select, limit }) => {
        const match = usable.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
        if (!match) return `No connector named "${name}". Available: ${roster}.`;
        try {
          if (match.kind === "supabase") {
            if (!table) return "A Supabase connector needs a table name.";
            onActivity(`Querying ${match.name}`);
            return await querySupabaseConnector(match, table, select || "*", limit ?? 10, signal);
          }
          if (!prompt) return "An AI connector needs a prompt.";
          onActivity(`Asking ${match.name}`);
          return await askAiConnector(match, prompt, signal);
        } catch (error) {
          return `The connector could not be reached: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    })
  };
}
