import type { Executor } from "../registry";

export const scrape: Executor = async (input, signal) => {
  const urls = String(input.urls ?? input.url ?? input.text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!urls.length || urls.length > 5 || urls.some(url => !/^https?:\/\//i.test(url))) return { ok: false, error: "Use /scrape followed by one to five public http(s) URLs." };
  try {
    const response = await fetch("/api/tools/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]) });
    if (!response.ok) return { ok: false, error: `Page extraction returned ${response.status}. Check that you are signed in.` };
    const body = await response.json() as { results: Array<{ url: string; ok: boolean; text?: string; guidance?: string }> };
    return { ok: true, output: body.results.map(item => `${item.url}\n${item.ok ? item.text : `Unavailable: ${item.guidance}`}`).join("\n\n---\n\n") };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Page extraction failed" }; }
};
