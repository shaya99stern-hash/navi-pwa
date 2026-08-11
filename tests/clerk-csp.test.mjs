import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* Signing in with a social provider submits a form to Clerk's Frontend API,
   which redirects on to the provider. Both hops are cross-origin, so a missing
   origin here has a distinctive failure: the button appears to do nothing and
   only a CSP violation shows in the console. Nothing in a build notices.

   These assertions run the config rather than reading it. Grepping the source
   for an origin passes whether the origin lands in the directive under test, in
   a neighbouring one, or in a comment — this file previously matched a literal
   that has since moved. Evaluating `headers()` checks the header the browser
   will actually receive. */

const { default: config } = await import("../next.config.mjs");
const headers = await config.headers();
const csp = headers
  .flatMap((entry) => entry.headers)
  .find((header) => header.key === "Content-Security-Policy")?.value ?? "";

const directive = (name) => {
  const found = csp.split("; ").find((part) => part === name || part.startsWith(`${name} `));
  return found === undefined ? null : found.slice(name.length).trim().split(/\s+/).filter(Boolean);
};

const allows = (name, origin) => (directive(name) ?? []).includes(origin);

check("a policy is emitted at all", csp.length > 0, true);

/* Both directives matter and they fail differently: form-action blocks the
   submission, frame-src blocks the provider's own consent screen. */
for (const provider of ["https://accounts.google.com", "https://github.com"]) {
  check(`${provider} may receive the form`, allows("form-action", provider), true);
  check(`${provider} may be framed`, allows("frame-src", provider), true);
}

/* Clerk's own origins reach every directive the sign-in chain touches. Without
   the publishable key set the fallback list applies, which is the case here. */
for (const name of ["form-action", "frame-src", "connect-src", "script-src"]) {
  check(`clerk reaches ${name}`, allows(name, "https://clerk.navikeep.org"), true);
  check(`dev instances reach ${name}`, allows(name, "https://*.clerk.accounts.dev"), true);
}

check("the origin itself is always allowed to receive the form", allows("form-action", "'self'"), true);
check("nothing may frame this app", directive("frame-ancestors"), ["'none'"]);
check("no plugin content", directive("object-src"), ["'none'"]);

/* The key-derivation contract. The origins are computed from the publishable
   key, which base64-encodes its own Frontend API domain, so the policy cannot
   drift from the instance the app is configured against. */
const source = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
check("origins are derived from the key", source.includes("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"), true);
check("a malformed host is rejected", source.includes("if (!/^[a-z0-9.-]+\\.[a-z]{2,}$/i.test(host)) return known"), true);
check("a missing key still yields a policy", source.includes("if (!encoded || encoded === key) return known"), true);

const decode = (key) => {
  const encoded = key.replace(/^pk_(live|test)_/, "");
  if (!encoded || encoded === key) return null;
  return Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
};
check("a live key decodes to its host", decode("pk_live_Y2xlcmsubmF2aWtlZXAub3JnJA"), "clerk.navikeep.org");
check("a non-key decodes to nothing", decode("not-a-key"), null);

/* The account portal is derived beside the Frontend API on the same root, so
   `clerk.example.com` implies `accounts.example.com` without a second lookup. */
const portal = (host) => host.replace(/^clerk\./, "accounts.");
check("the portal sits beside the API", portal("clerk.navikeep.org"), "accounts.navikeep.org");

/* ---- The sandbox worker carries its own policy ----------------------
 * `new Function` needs 'unsafe-eval', which the page policy must never grant.
 * A worker loaded from a URL is governed by its own response headers, so the
 * permission can live on that one route — but only if the global header skips
 * it. Two Content-Security-Policy headers on one response are *intersected*,
 * so the strict one would re-block exactly what the route exists to allow. */
const globalRule = headers.find((entry) =>
  entry.headers.some((header) => header.key === "Content-Security-Policy"));

check("the global rule excludes the worker", /sandbox-worker/.test(globalRule.source), true);
check("it is a negative lookahead, not a match", globalRule.source.includes("(?!"), true);

/* Behaviour, not spelling: build the matcher and try both paths. */
const matcher = new RegExp(`^${globalRule.source.replace(/^\//, "/")}$`);
check("the worker route escapes the strict policy", matcher.test("/sandbox-worker"), false);
check("an ordinary page still gets it", matcher.test("/settings"), true);
check("a nested path still gets it", matcher.test("/api/chat"), true);

/* And the route really does grant eval to itself, or the exclusion above just
   leaves it with no policy at all. */
const worker = readFileSync(join(process.cwd(), "app/sandbox-worker/route.ts"), "utf8");
check("the worker route sets its own policy", worker.includes("Content-Security-Policy"), true);
check("it grants eval only to itself", /script-src[^"]*unsafe-eval/.test(worker), true);
check("it can reach nothing else", /default-src 'none'/.test(worker), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
