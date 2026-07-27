import { generateNaviImage } from "@/lib/ai/image-generation";

export const runtime = "edge";
export const maxDuration = 60;

export function GET(request: Request): Response {
  const url = new URL(request.url);
  if (url.searchParams.get("check") !== "navi-image-smoke-v1") return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  void (async () => {
    try {
      await writer.write(encoder.encode("started\n"));
      const image = await generateNaviImage({
        prompt: "A realistic respectful portrait of a Jewish boy wearing a kippah, natural daylight, professional photography, no text",
        abortSignal: request.signal
      });
      await writer.write(encoder.encode(`${JSON.stringify({
        ok: true,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        base64Characters: image.data.length,
        prefix: image.data.slice(0, 24)
      })}\n`));
    } catch (error) {
      await writer.write(encoder.encode(`${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })}\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}
