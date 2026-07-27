import { callMcp } from "@/lib/mcp";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { serverId?: string; cursor?: string };
    if (!body.serverId) return Response.json({ error: "serverId is required." }, { status: 400 });
    const result = await callMcp(body.serverId, "resources/list", body.cursor ? { cursor: body.cursor } : {}, request.signal);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "MCP resource request failed." }, { status: 502 });
  }
}
