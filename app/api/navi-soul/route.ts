/* PATH: app/api/navi-soul/route.ts  — NEW FILE, copy verbatim. */

import { decideLocally } from "@/lib/ai/navi-soul/router";
import { NAVI_VERSION } from "@/lib/version";

export const runtime = "edge";

/**
 * The pre-flight check the composer makes before it opens a stream.
 *
 * Cheap by construction: no model, no provider, no tools, no auth-gated data.
 * It answers what the device could have answered and otherwise says "model",
 * at which point the client sends the request to `/api/chat` exactly as before.
 *
 * It exists as a route rather than only as a client import so the same decision
 * is available to anything that talks to NaviOS over HTTP, and so the local
 * answer for a slash command cannot drift between the two callers.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { query?: unknown; routes?: unknown; online?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ route: "model" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.slice(0, 500) : "";
  const routes = Array.isArray(body.routes)
    ? body.routes.filter((route): route is string => typeof route === "string").slice(0, 20)
    : undefined;

  const decision = decideLocally(query, {
    routes,
    version: NAVI_VERSION,
    online: body.online === false ? false : true
  });

  /* No caching: `/status` reports state that changes, and a cached "Online."
     served while offline is worse than no answer. */
  return Response.json(decision, { headers: { "cache-control": "no-store" } });
}
