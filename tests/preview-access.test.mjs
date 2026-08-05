import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* A preview deployment has to be openable, or nothing can be checked before it
   merges. The canonical-origin redirect is right in production — it keeps a
   Clerk session on one hostname — and wrong on a preview, whose generated
   hostname is the only address that deployment has.

   Asserted against the source rather than by importing, because the module is
   `server-only` and reads its answer from the environment at call time. */

const root = process.cwd();
const config = readFileSync(join(root, "lib/auth/config.ts"), "utf8");
const middleware = readFileSync(join(root, "proxy.ts"), "utf8");

const fn = config.slice(config.indexOf("export function getNaviAuthCanonicalOrigin"));
const body = fn.slice(0, fn.indexOf("\n}") + 2);

check("the canonical origin consults the deployment kind", body.includes("VERCEL_ENV"), true);
check("a non-production deployment has no canonical origin", /!==\s*"production"\)\s*return undefined/.test(body), true);
check("production still redirects", body.includes("NAVI_AUTH_CANONICAL_ORIGIN"), true);
/* No VERCEL_ENV means local or self-hosted, where the configured origin should
   still be honoured — the guard must not swallow that case. */
check("an absent deployment kind is not treated as preview", /const deployment = process\.env\.VERCEL_ENV;[\s\S]{0,120}deployment &&/.test(body), true);

// The middleware still performs the redirect when an origin is returned.
check("the middleware still enforces a canonical origin", middleware.includes("getNaviAuthCanonicalOrigin()"), true);
check("the redirect is conditional on there being one", /if \(canonicalOrigin &&/.test(middleware), true);

/* Sign-in and sign-up stay reachable regardless, or a misconfigured deployment
   traps the user on a redirect loop with no way to authenticate. */
check("sign-in is a public route", /pathname === "\/sign-in"/.test(middleware), true);
check("an unconfigured Clerk leaves the app open", middleware.includes("if (!isClerkConfigured()) return NextResponse.next();"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
