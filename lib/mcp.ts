type McpRegistryEntry = {
  id: string;
  name: string;
  url: string;
  authorization?: string;
  readOnly?: boolean;
  writeTools?: string[];
};

export type PublicMcpServer = Omit<McpRegistryEntry, "authorization" | "writeTools"> & {
  configured: true;
};

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower.endsWith(".local")) return true;
  if (/^127\./.test(lower) || /^10\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower)) return true;
  const match = lower.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function validateEntry(value: unknown): McpRegistryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<McpRegistryEntry>;
  if (typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id)) return null;
  if (typeof entry.name !== "string" || entry.name.length < 1 || entry.name.length > 100) return null;
  if (typeof entry.url !== "string") return null;
  try {
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) return null;
  } catch {
    return null;
  }
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    authorization: typeof entry.authorization === "string" ? entry.authorization : undefined,
    readOnly: entry.readOnly !== false,
    writeTools: Array.isArray(entry.writeTools) ? entry.writeTools.filter((tool): tool is string => typeof tool === "string") : []
  };
}

export function getMcpRegistry(): McpRegistryEntry[] {
  try {
    const raw = process.env.MCP_SERVER_REGISTRY_JSON ?? "[]";
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(validateEntry).filter((entry): entry is McpRegistryEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function publicMcpRegistry(): PublicMcpServer[] {
  return getMcpRegistry().map(({ authorization: _authorization, writeTools: _writeTools, ...server }) => ({ ...server, configured: true }));
}

function parseMcpResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) {
    const line = trimmed.split("\n").find((candidate) => candidate.startsWith("data:"));
    if (!line) return null;
    return JSON.parse(line.slice(5).trim());
  }
  return JSON.parse(trimmed);
}

export async function callMcp(serverId: string, method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  const server = getMcpRegistry().find((candidate) => candidate.id === serverId);
  if (!server) throw new Error("MCP server is not configured.");
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(server.authorization ? { Authorization: server.authorization } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`MCP server returned ${response.status}.`);
  const payload = parseMcpResponse(await response.text()) as { error?: { message?: string }; result?: unknown } | null;
  if (payload?.error) throw new Error(payload.error.message || "MCP request failed.");
  return payload?.result ?? payload;
}

export function requiresMcpConfirmation(serverId: string, toolName: string): boolean {
  const server = getMcpRegistry().find((candidate) => candidate.id === serverId);
  if (!server) return true;
  if (server.readOnly) return false;
  return server.writeTools?.includes(toolName) ?? true;
}

export async function gatherMcpMetadata(serverIds: string[], signal?: AbortSignal): Promise<string> {
  const allowedIds = new Set(getMcpRegistry().map((server) => server.id));
  const selected = serverIds.filter((id) => allowedIds.has(id)).slice(0, 3);
  const results = await Promise.allSettled(
    selected.map(async (serverId) => {
      const resources = (await callMcp(serverId, "resources/list", {}, signal)) as { resources?: Array<{ name?: string; uri?: string; description?: string }> };
      const lines = (resources.resources ?? []).slice(0, 10).map((resource) => `- ${resource.name ?? "Resource"}: ${resource.uri ?? ""}${resource.description ? ` — ${resource.description}` : ""}`);
      return `${serverId}\n${lines.join("\n")}`;
    })
  );
  return results
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value)
    .join("\n\n");
}
