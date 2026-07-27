import { callMcp, requiresMcpConfirmation } from "@/lib/mcp";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      serverId?: string;
      action?: "list" | "call";
      toolName?: string;
      arguments?: unknown;
      confirmed?: boolean;
      threadId?: string;
    };
    if (!body.serverId || !body.action) return Response.json({ error: "serverId and action are required." }, { status: 400 });
    if (body.action === "list") {
      const result = await callMcp(body.serverId, "tools/list", {}, request.signal);
      return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!body.toolName || body.toolName.length > 120) return Response.json({ error: "A valid toolName is required." }, { status: 400 });
    if (JSON.stringify(body.arguments ?? {}).length > 60_000) return Response.json({ error: "Tool input is too large." }, { status: 413 });
    if (requiresMcpConfirmation(body.serverId, body.toolName) && body.confirmed !== true) {
      return Response.json({ confirmationRequired: true, error: "This tool may write or change external data." }, { status: 409 });
    }
    const result = await callMcp(body.serverId, "tools/call", { name: body.toolName, arguments: body.arguments ?? {} }, request.signal);
    console.info("Navi MCP tool invocation", { serverId: body.serverId, toolName: body.toolName, threadId: body.threadId ?? "unknown" });
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "MCP tool request failed." }, { status: 502 });
  }
}
