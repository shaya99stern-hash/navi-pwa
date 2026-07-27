export const runtime = "edge";

const ALLOWED_NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "unknown";
    const value = typeof body.value === "number" && Number.isFinite(body.value) ? body.value : null;
    if (!ALLOWED_NAMES.has(name) || value === null) return new Response(null, { status: 204 });

    console.info("Navi web vital", {
      name,
      value,
      rating: typeof body.rating === "string" ? body.rating : undefined,
      path: typeof body.path === "string" ? body.path.slice(0, 180) : undefined,
      navigationType: typeof body.navigationType === "string" ? body.navigationType : undefined
    });
  } catch {
    // Metrics are best-effort and must never affect the app experience.
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
