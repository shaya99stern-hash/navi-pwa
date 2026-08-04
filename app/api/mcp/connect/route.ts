import { authorizeApiMutation } from "@/lib/auth/api";
import { callMcp, publicMcpRegistry } from "@/lib/mcp";

export const runtime = "edge";

export function GET(): Response {
  return Response.json({ servers: publicMcpRegistry() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const authorizationError = await authorizeApiMutation(request);
  if (authorizationError) return authorizationError;
  try {
    const body = (await request.json()) as { serverId?: string };
    if (!body.serverId) return Response.json({ error: "serverId is required." }, { status: 400 });
    const result = await callMcp(
      body.serverId,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "NaviOS", version: "4.4.0" }
      },
      request.signal
    );
    return Response.json({ connected: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Navi MCP connection failed:", error);
    return Response.json({ connected: false, error: "The connector could not be reached. Check its server configuration and try again." }, { status: 502 });
  }
}
