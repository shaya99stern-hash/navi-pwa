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
   only a CSP violation shows in the console. Nothing in a build notices. */

const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

// Derived from the publishable key, which encodes its own Frontend API domain.
check("origins are derived from the key", config.includes("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"), true);
check("the key's base64 host is decoded", config.includes('Buffer.from(encoded, "base64")'), true);
check("the account portal is derived beside it", config.includes('host.replace(/^clerk\\./, "accounts.")'), true);
check("a malformed host is rejected", config.includes("if (!/^[a-z0-9.-]+\\.[a-z]{2,}$/i.test(host)) return known"), true);
check("a missing key still yields a policy", config.includes("if (!encoded || encoded === key) return known"), true);
check("development instances are always allowed", config.includes("https://*.clerk.accounts.dev"), true);

/* Both directives matter and they fail differently: form-action blocks the
   submission, frame-src blocks the provider's own consent screen. */
check("google is allowed to receive the form", /form-action[^`]*accounts\.google\.com/.test(config), true);
check("google is allowed to be framed", /frame-src[^`]*accounts\.google\.com/.test(config), true);
check("clerk origins reach form-action", /form-action 'self' \$\{clerk\}/.test(config), true);
check("clerk origins reach frame-src", /frame-src 'self' data: blob: \$\{clerk\}/.test(config), true);
check("clerk origins reach connect-src", /connect-src 'self' \$\{clerk\}/.test(config), true);
check("clerk origins reach script-src", /script-src 'self' 'unsafe-inline'\$\{developmentEval\} \$\{clerk\}/.test(config), true);

/* The decoding contract, checked against a real key shape rather than assumed. */
const decode = (key) => {
  const encoded = key.replace(/^pk_(live|test)_/, "");
  if (!encoded || encoded === key) return null;
  return Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
};
check("a live key decodes to its host", decode("pk_live_Y2xlcmsubmF2aWtlZXAub3JnJA"), "clerk.navikeep.org");
check("a non-key decodes to nothing", decode("not-a-key"), null);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
