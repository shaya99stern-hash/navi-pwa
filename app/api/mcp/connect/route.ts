import { callMcp, publicMcpRegistry } from "@/lib/mcp";

export const runtime = "edge";

export function GET(): Response {
  return Response.json({ servers: publicMcpRegistry() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { serverId?: string };
    if (!body.serverId) return Response.json({ error: "serverId is required." }, { status: 400 });
    const result = await callMcp(
      body.serverId,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Navi", version: "3.0.0" }
      },
      request.signal
    );
    return Response.json({ connected: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : "MCP connection failed." }, { status: 502 });
  }
}
