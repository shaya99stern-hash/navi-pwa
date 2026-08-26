/**
 * The code-execution worker, served with a CSP of its own.
 *
 * Running generated JavaScript requires compiling a string, and compiling a
 * string requires `'unsafe-eval'`. Granting that to the page would hand it to
 * every script the app loads. A worker fetched from a URL is governed by the
 * CSP on its own response, so the permission lives here and nowhere else.
 *
 * Everything except script is denied outright. The worker body already deletes
 * `fetch`, `XMLHttpRequest`, storage and the rest before user code compiles;
 * `default-src 'none'` means that even if one of those deletions were defeated,
 * the request still has no destination it is allowed to reach.
 */
import { WORKER_SOURCE } from "@/lib/execution/sandbox";

/* This route is build-time constant, so keep it static. Next.js 16 does not
   support `runtime = "edge"` together with `dynamic = "force-static"`; that
   combination produced a build warning and disabled the static optimization
   we actually want for this immutable worker body. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      /* Immutable for a day: the body only changes when the app is rebuilt,
         and a stale worker is a stale sandbox, not a stale page. */
      "Cache-Control": "public, max-age=86400, must-revalidate"
    }
  });
}
