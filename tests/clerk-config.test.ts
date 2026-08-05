/* `lib/auth/config.ts` starts with `import "server-only"`, which throws outside
   a server component and would take this file with it. The sibling
   preview-access test works around that by asserting against the source text,
   but these are branching predicates with a wrong answer that disabled sign-in
   on a correctly configured deployment — reading the source would only prove
   the source says what it says. So point the specifier at a harmless module and
   exercise the real functions. */
const serverOnly = require.resolve("server-only");
require.cache[serverOnly] = {
  id: serverOnly, filename: serverOnly, loaded: true, exports: {}
} as unknown as NodeModule;

const {
  clerkJwtKeyIsMalformed,
  describeClerkConfigGap,
  getClerkJwtKey,
  getClerkPublishableKey,
  getClerkSecretKey,
  isClerkConfigured
} = require("../lib/auth/config") as typeof import("../lib/auth/config");

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_PUBLISHABLE_KEY",
  "CLERK_JWT_KEY", "CLERK_PEM_PUBLIC_KEY", "CLERK_JWT_VERIFICATION_KEY",
  "CLERK_SECRET_KEY", "CLERK_API_KEY"
];
const clear = () => { for (const key of KEYS) delete process.env[key]; };

const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg\n-----END PUBLIC KEY-----";
/* What Clerk's dashboard actually hands you when you click the thing labelled
   JWKS. Neither of these is a jwtKey, and both look plausible. */
const JWKS_URL = "https://clerk.navikeep.org/.well-known/jwks.json";
const JWKS_JSON = '{"keys":[{"use":"sig","kty":"RSA","kid":"ins_1","alg":"RS256","n":"xGOr","e":"AQAB"}]}';

function main() {
  /* ---- What counts as configured -------------------------------------- */

  clear();
  check("nothing set is not configured", isClerkConfigured(), false);

  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_abc";
  check("a publishable key alone is not enough", isClerkConfigured(), false);

  /* The regression this file exists for. A deployment with a publishable key
     and a secret key is an ordinary, complete Clerk setup — and sign-in was
     disabled entirely because no PEM had been pasted anywhere. */
  process.env.CLERK_SECRET_KEY = "sk_live_xyz";
  check("publishable plus secret is configured", isClerkConfigured(), true);
  check("no gap is reported", describeClerkConfigGap(), null);

  clear();
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_abc";
  process.env.CLERK_JWT_KEY = PEM;
  check("publishable plus a PEM is also configured", isClerkConfigured(), true);

  /* ---- Name aliases ---------------------------------------------------- */

  clear();
  process.env.CLERK_PUBLISHABLE_KEY = "pk_live_abc";
  process.env.CLERK_API_KEY = "sk_live_xyz";
  check("the server-side publishable alias is read", getClerkPublishableKey(), "pk_live_abc");
  check("the secret key alias is read", getClerkSecretKey(), "sk_live_xyz");
  check("aliases alone configure it", isClerkConfigured(), true);

  clear();
  process.env.CLERK_PEM_PUBLIC_KEY = PEM;
  check("the PEM alias is read", getClerkJwtKey(), PEM);

  /* ---- Shape checks, so a wrong value is not trusted -------------------- */

  clear();
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "not-a-key";
  check("a publishable key must start with pk_", getClerkPublishableKey(), undefined);
  process.env.CLERK_SECRET_KEY = "pk_live_wrong_field";
  check("a secret key must start with sk_", getClerkSecretKey(), undefined);

  /* The exact mistake: JWKS URL or JSON pasted where a PEM belongs. Passing
     either to verifyToken throws, which reads as an invalid session — every
     request looks signed out and nothing says why. So it must not be accepted
     as a jwtKey, and it must be named in the gap description. */
  clear();
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_abc";
  process.env.CLERK_JWT_KEY = JWKS_URL;
  check("a JWKS URL is not a PEM", getClerkJwtKey(), undefined);
  check("a JWKS URL is reported as malformed", clerkJwtKeyIsMalformed(), true);
  check("a JWKS URL alone leaves it unconfigured", isClerkConfigured(), false);
  check("the gap names the JWKS confusion", /JWKS URL or the JWKS JSON/.test(describeClerkConfigGap() ?? ""), true);
  check("the gap offers the secret key as the way out", /CLERK_SECRET_KEY/.test(describeClerkConfigGap() ?? ""), true);
  /* It must not say "missing" about a variable that is plainly set — that is
     what sends people back to re-paste the same wrong value. */
  check("the gap does not call it missing", /missing/i.test(describeClerkConfigGap() ?? ""), false);

  process.env.CLERK_JWT_KEY = JWKS_JSON;
  check("JWKS JSON is not a PEM either", getClerkJwtKey(), undefined);
  check("JWKS JSON is reported as malformed", clerkJwtKeyIsMalformed(), true);

  /* A bad PEM plus a good secret key still works — the secret key is the
     fallback precisely so a wrong paste is not fatal. */
  process.env.CLERK_SECRET_KEY = "sk_live_xyz";
  check("a secret key rescues a malformed PEM", isClerkConfigured(), true);
  check("and no gap is reported then", describeClerkConfigGap(), null);

  /* ---- The gap description when nothing is set ------------------------- */

  clear();
  const gap = describeClerkConfigGap() ?? "";
  check("an empty deployment reports a gap", gap.length > 0, true);
  check("it names the publishable key", /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/.test(gap), true);
  check("it names a verification credential", /CLERK_SECRET_KEY/.test(gap), true);
  check("nothing set is not called malformed", clerkJwtKeyIsMalformed(), false);

  clear();
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main();

/* A module, not a script. With only `require` and no import or export,
   TypeScript scopes these declarations globally, so two such test files
   collide on `pass`, `check`, and everything else. */
export {};
