import { generateNaviImage } from "@/lib/ai/image-generation";

export const runtime = "edge";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("check") !== "navi-image-smoke-v1") return new Response("Not found", { status: 404 });
  const image = await generateNaviImage({
    prompt: "A realistic respectful portrait of a Jewish boy wearing a kippah, natural daylight, professional photography, no text",
    abortSignal: request.signal
  });
  return Response.json({
    ok: true,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    base64Characters: image.data.length,
    prefix: image.data.slice(0, 24)
  }, { headers: { "Cache-Control": "no-store" } });
}
