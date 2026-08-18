import { describeAttempts, discoverFromSpec, specCandidates } from "@/lib/ai/capabilities/discover";
import { SPEC_PATHS } from "@/lib/ai/capabilities/openapi";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Finding the spec, so nobody has to find it themselves ───────────────────
   The promise is: paste a base URL and a key, and Navi Soul knows what to do
   with it. That rests entirely on not asking the person where their API's spec
   lives — most of them do not know whether it has one.

   Nothing standardises the location, so this guesses from a short fixed list.
   What it must never become is a scanner: the list is documentation paths only,
   against a host the person just chose to add. */

/* ── Which addresses get tried ───────────────────────────────────────────── */

const candidates = specCandidates("https://api.example.com/v2");

check("the conventional paths are tried under the base given",
  candidates.includes("https://api.example.com/v2/openapi.json"), true);
/* An API rooted at `/v2` documents itself at `/v2/openapi.json` about as often
   as at `/openapi.json`, and there is no way to tell which from the outside. */
check("and under the bare origin as well",
  candidates.includes("https://api.example.com/openapi.json"), true);
check("covering every path in the list",
  SPEC_PATHS.every((path) => candidates.includes(`https://api.example.com/v2${path}`)), true);
check("with no duplicates", candidates.length, new Set(candidates).size);

/* A base URL that is already an origin should not produce the same address
   twice under two spellings. */
const atRoot = specCandidates("https://api.example.com");
check("an origin-only base does not double up", atRoot.length, new Set(atRoot).size);
check("and still tries the conventional paths",
  atRoot.includes("https://api.example.com/swagger.json"), true);

/* If they paste the spec address itself, that is their own answer about where
   it lives and it beats every guess. */
check("a url that names a document is tried first",
  specCandidates("https://api.example.com/custom/spec.json")[0], "https://api.example.com/custom/spec.json");
check("as is one that names openapi without an extension",
  specCandidates("https://api.example.com/openapi")[0], "https://api.example.com/openapi");
/* Trailing slashes are how the same address becomes two. */
check("a trailing slash does not change the candidates",
  specCandidates("https://api.example.com/v2/"), specCandidates("https://api.example.com/v2"));

check("something that is not a url yields nothing to try", specCandidates("not a url"), []);

/* ── Discovery against a stubbed network ─────────────────────────────────────
   `fetch` is replaced so the real guards still run — the URL check, the
   redirect re-validation, the byte cap — while the responses are ours. */

const realFetch = globalThis.fetch;
const served = new Map<string, { status?: number; body: string }>();
let requested: string[] = [];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);
  const entry = served.get(url);
  if (!entry) return new Response("not found", { status: 404 });
  return new Response(entry.body, { status: entry.status ?? 200 });
}) as typeof fetch;

/* Wrapped in a main: this suite runs under tsx's CJS transform, which has no
   top-level await. */
async function main() {
  const SPEC = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Imagery", description: "Satellite imagery." },
    servers: [{ url: "https://api.example.com/v1" }],
    paths: { "/images": { get: { operationId: "listImages", summary: "List images." } } }
  });

  async function discover(baseUrl = "https://api.example.com") {
    requested = [];
    return discoverFromSpec({ baseUrl, id: "imagery" });
  }

  served.set("https://api.example.com/openapi.json", { body: SPEC });
  const found = await discover();
  check("a spec at the first conventional address is found", found.ok, true);
  check("and becomes a manifest", found.ok && found.manifest.operations.map((operation) => operation.id), ["listImages"]);
  check("recording where it came from", found.ok && found.specUrl, "https://api.example.com/openapi.json");
  /* Stopping at the first hit is what keeps this from being eight requests every
     time it succeeds on the first. */
  check("and it stops looking once it has one", requested.length, 1);

  /* The list is walked in order, so an API that only publishes at a later
     convention is still found. */
  served.clear();
  served.set("https://api.example.com/swagger.json", { body: SPEC });
  const later = await discover();
  check("a spec at a later address is found too", later.ok, true);
  check("after the earlier ones were tried and missed",
    later.ok === false ? [] : later.attempts.map((attempt) => attempt.outcome).slice(0, 1), ["404"]);

  /* ── Failures say what was actually tried ────────────────────────────────────
     "We could not find a spec", with no list behind it, is indistinguishable from
     not having looked — and this app has shipped that shape of non-answer before. */

  served.clear();
  const missing = await discover();
  check("nothing found is reported as nothing found", missing.ok, false);
  check("with a reason", missing.ok === false && missing.reason, "No OpenAPI document at any of the conventional addresses.");
  check("and every address that was tried", missing.ok === false && missing.attempts.length > 4, true);
  check("each with what happened to it",
    missing.ok === false && missing.attempts.every((attempt) => attempt.outcome.length > 0), true);
  check("rendered for a person to read",
    describeAttempts([{ url: "https://a.example/openapi.json", outcome: "404" }]),
    "- https://a.example/openapi.json — 404");
  check("and an empty run says so", describeAttempts([]), "Nothing was tried.");

  /* A YAML spec means the API *does* describe itself and this app cannot read
     that form yet. That is a different thing to tell someone than "no spec", and
     the JSON sibling is usually one path away. */
  served.clear();
  served.set("https://api.example.com/openapi.yaml", { body: "openapi: 3.0.0\npaths:\n  /a:\n    get: {}\n" });
  const yaml = await discover();
  check("a YAML spec is not reported as no spec", yaml.ok, false);
  check("it is named as YAML, with the way forward",
    yaml.ok === false && /it is YAML and only JSON can be read so far/.test(yaml.reason), true);
  check("and the address it was found at is quoted",
    yaml.ok === false && yaml.reason.includes("https://api.example.com/openapi.yaml"), true);

  /* JSON that is not a spec is common at `/api-docs`, which is as often a viewer
     page's data as the document itself. The parser's own reason is carried
     through rather than flattened into "not found". */
  served.clear();
  served.set("https://api.example.com/openapi.json", { body: JSON.stringify({ hello: "world" }) });
  const notSpec = await discover();
  check("json that is not a spec is refused", notSpec.ok, false);
  check("with the parser's own reason kept",
    notSpec.ok === false && notSpec.attempts[0].outcome,
    "No `openapi` or `swagger` version field, so this is not an OpenAPI document.");

  /* ── The guards are the shared ones, and they still apply ────────────────── */

  const insecure = await discoverFromSpec({ baseUrl: "http://api.example.com", id: "x" });
  check("plain http is refused", insecure.ok, false);
  check("and named as the reason rather than a generic miss",
    insecure.ok === false && insecure.attempts.some((attempt) => /https/i.test(attempt.outcome)), true);

  const internal = await discoverFromSpec({ baseUrl: "https://169.254.169.254", id: "x" });
  check("a link-local address is refused", internal.ok, false);
  check("which is what stops a spec fetch reaching the metadata service",
    internal.ok === false && internal.attempts.some((attempt) => /not reachable/i.test(attempt.outcome)), true);
  globalThis.fetch = realFetch;
}

void main().then(() => {

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
});
