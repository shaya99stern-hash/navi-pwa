import { authorizeApiMutation } from "@/lib/auth/api";
import { readUrl } from "@/lib/ai/web-tools";

export const runtime = "edge";
export const maxDuration = 30;
export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (Number(request.headers.get("content-length") ?? 0) > 8_000) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: { urls?: unknown };
  try { const raw = await request.text(); if (raw.length > 8_000) throw new Error(); body = JSON.parse(raw); }
  catch { return Response.json({ error: "Send a short JSON list of URLs" }, { status: 400 }); }
  if (!Array.isArray(body.urls) || !body.urls.length || body.urls.length > 5 || body.urls.some(url => typeof url !== "string" || url.length > 1_500)) {
    return Response.json({ error: "Provide one to five public URLs" }, { status: 400 });
  }
  const urls = [...new Set(body.urls as string[])];
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  const results = await Promise.all(urls.map(async url => ({ url, ...await readUrl(url, { signal }) })));
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
