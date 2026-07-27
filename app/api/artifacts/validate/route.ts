import { validateArtifactPayload } from "@/lib/security/artifacts";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Artifact request must be valid JSON." }, { status: 400 });
  }
  const result = validateArtifactPayload(body);
  return result.ok
    ? Response.json({ valid: true, payload: result.payload }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ valid: false, error: result.error }, { status: 422, headers: { "Cache-Control": "no-store" } });
}
