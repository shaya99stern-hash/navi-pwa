import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selfRepoKnowledge } from "@/lib/ai/app-knowledge";
import { findProvider } from "@/lib/ai/provider-catalog";
import { describeProbe, planProbe, runProbe } from "@/lib/ai/service-probe";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n?/g, "\n");

/* ── The report ──────────────────────────────────────────────────────────────
   The owner said the app claimed a GitHub connection it did not have. It did,
   and it was not the model inventing one: `inspect_environment` — which the
   system prompt names as the only authority on configuration, with an explicit
   instruction never to answer from memory — rendered every service as
   "connected" whenever an environment variable held a non-empty string.

   A revoked token is a non-empty string. So is one for the wrong account, and
   so is the word "changeme". All of them reported as connected, forever, and
   the model repeated what it was told.

   These tests hold the three states apart: no key, a key nobody has tried, and
   a key that was actually used against the real API. */

const NAMES = [
  "GITHUB_PAT", "NAVI_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN",
  "NAVI_VERCEL_TOKEN", "VERCEL_API_TOKEN", "VERCEL_TOKEN",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"
];
const saved = new Map(NAMES.map((name) => [name, process.env[name]]));
const clear = () => NAMES.forEach((name) => { delete process.env[name]; });
const restore = () => saved.forEach((value, name) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
});

const entry = (name: string) => findProvider(name)!;
const realFetch = globalThis.fetch;

async function main() {
  clear();

  /* ── Which services can be checked at all ────────────────────────────────
     The old `test_service` resolved a service to a model adapter and gave up on
     anything that was not one — which was every service in the catalogue that
     is not a model, including both the owner asked about. */

  process.env.GITHUB_PAT = "ghp_example";
  const github = planProbe(entry("github"));
  check("GitHub can be checked for real", github.kind, "request");
  check("against the endpoint that names the account",
    github.kind === "request" ? github.url : "", "https://api.github.com/user");
  /* GitHub refuses requests without a User-Agent, so a probe missing one fails
     as "rejected" and would send someone to replace a working key. */
  check("carrying the header GitHub requires",
    github.kind === "request" ? Boolean(github.headers["User-Agent"]) : false, true);

  /* Two entirely separate GitHub credentials reach two different sets of tools.
     Testing the deployment's token and reporting it as the answer to "is GitHub
     working" is a confident answer about something nobody asked. */
  const asAccount = planProbe(entry("github"), { githubToken: "gho_account" });
  check("a connected account is what gets tested",
    asAccount.kind === "request" ? asAccount.headers.Authorization : "", "Bearer gho_account");
  check("and the answer says whose credential it was",
    asAccount.kind === "request" ? asAccount.subject : "", "your connected GitHub account");
  check("with no account, the deployment's own token is tested",
    github.kind === "request" ? github.headers.Authorization : "", "Bearer ghp_example");
  check("and that is said out loud rather than left ambiguous",
    github.kind === "request" && (github.subject ?? "").includes("no account is connected"), true);

  process.env.NAVI_VERCEL_TOKEN = "vc_example";
  check("Vercel can be checked too", planProbe(entry("vercel")).kind, "request");

  /* One connection described by two catalogue rows. Either row probes the pair,
     and half a configuration is reported as the missing half rather than as a
     failure. */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  const halfSupabase = planProbe(entry("supabase url"));
  check("half a Supabase configuration is not probeable", halfSupabase.kind, "none");
  check("and it names the half that is missing",
    halfSupabase.kind === "none" && halfSupabase.why.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"), true);
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  check("with both halves it can be checked", planProbe(entry("supabase")).kind, "request");
  /* An http URL would send the key over the wire in the clear. */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://project.supabase.co";
  check("but never over plain http", planProbe(entry("supabase")).kind, "none");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";

  /* ── The refusals, which are answers rather than gaps ────────────────────
     "Set but unverified", with no reason, is indistinguishable from not having
     looked. Every refusal here says why. */

  const tavily = planProbe(entry("tavily"));
  check("a search provider is not probed", tavily.kind, "none");
  /* This deployment runs on free tiers deliberately. A self-test that spends a
     search is a self-test that costs the owner the thing it is reporting on. */
  check("because testing it would spend the free allowance it reports on",
    tavily.kind === "none" && tavily.why.includes("spend"), true);

  const writes = planProbe(entry("github writes"));
  check("a yes/no setting is not probed", writes.kind, "none");
  check("and says it is a setting rather than a key",
    writes.kind === "none" && writes.why.includes("setting"), true);

  /* ── What came back ──────────────────────────────────────────────────────
     Rejected and unreachable must stay apart: one means replace the key, the
     other means try again later, and telling someone to replace a working
     credential is its own wrong answer. */

  const stub = (status: number, body: unknown = {}) => {
    globalThis.fetch = (async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    })) as never;
  };

  const plan = planProbe(entry("github"));
  stub(200, { login: "shaya99stern-hash" });
  const working = await runProbe(plan);
  check("a working key reads as working", working.kind, "working");
  /* The question underneath "am I connected to GitHub" is usually "as whom". */
  check("and names the account it belongs to",
    working.kind === "working" ? working.identity : null, "shaya99stern-hash");

  stub(401);
  check("a revoked key is rejected, not merely absent", (await runProbe(plan)).kind, "rejected");
  stub(429);
  check("a rate limit is not a broken key", (await runProbe(plan)).kind, "limited");
  stub(500);
  check("an outage is not a broken key either", (await runProbe(plan)).kind, "unreachable");

  /* A 200 whose body will not parse is still an accepted credential. */
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } })) as never;
  const unparsed = await runProbe(plan);
  check("a 200 with an unreadable body still means the key works", unparsed.kind, "working");
  check("with no account claimed", unparsed.kind === "working" ? unparsed.identity : "x", null);

  globalThis.fetch = (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as never;
  check("a timeout never throws into the turn", (await runProbe(plan)).kind, "unreachable");

  globalThis.fetch = realFetch;

  /* The sentence a person reads. A working key for the wrong account is the
     failure that looks most like success, so the account is stated. */
  check("the sentence names which credential was tested",
    describeProbe(entry("github"), { kind: "working", identity: "octocat" }, "your connected GitHub account")
      .includes("This tested your connected GitHub account."), true);
  check("a working key is described with its account",
    describeProbe(entry("github"), { kind: "working", identity: "octocat" }).includes("`octocat`"), true);
  check("and a rejected one points at where a new key comes from",
    describeProbe(entry("github"), { kind: "rejected", detail: "answered 401" }).includes(entry("github").keyUrl), true);

  restore();

  /* ── Read from the production wiring ─────────────────────────────────────
     Assertions against source, because the defect was never in a function — it
     was in which words the tool chose and which arguments the caller passed. */

  const root = process.cwd();
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const envTools = strip(readSource("lib/ai/environment-tools.ts"));
  const registry = strip(readSource("lib/tools/registry.ts"));
  const route = strip(readSource("app/api/chat/route.ts"));

  /* The exact line the owner was reading, and the word it must no longer use.
     A present variable is a present variable. */
  check("a present environment variable is no longer called a connection",
    /on \? "connected" : "not set"/.test(envTools), false);
  check("it is called what it is", /key set, unverified/.test(envTools), true);
  check("and the list says outright that a key may not work",
    /whether a key is present — not whether it still works/.test(envTools), true);
  check("with the tool that can settle it named",
    /call `test_service` and answer from what it returns/.test(envTools), true);

  /* Corrected once already in the prose and missed here, which is how the one
     tool the prompt calls authoritative ended up making the promise the prose
     had stopped making. */
  check("self-editing no longer claims commits deploy themselves",
    /commits deploy automatically/.test(envTools), false);
  check("it says a pull request has to be merged first",
    /they are NOT live until it is merged/.test(envTools), true);

  /* Google has no catalogue row because there is no Google key — only a person
     who did or did not sign in. Before this it was reported nowhere, so a
     question about Gmail had nothing to read and got an invented answer. */
  check("Google is reported at all", /Gmail and Calendar/.test(envTools), true);
  check("and is stated to have no key to look for",
    /There is no Google API key anywhere in this app/.test(envTools), true);

  /* Two different GitHubs: the deployment's own token, and the person's
     account. Either can exist without the other. */
  check("the two GitHubs are held apart",
    /never infer one from the other/.test(envTools), true);

  /* Not connected and cannot be connected are different problems with
     different fixes, and one of them is not the user's to solve. */
  check("an unconfigured OAuth app is distinguished from an unconnected one",
    /has no OAuth app configured/.test(envTools), true);
  /* If the wiring below ever regresses, the tool must say so rather than
     report a plumbing fault as a disconnected account. */
  check("and unreported is distinguished from both",
    /wiring fault in the app, not a disconnected account/.test(envTools), true);

  check("the registry passes the account connections",
    /connections: \{\s*github: Boolean\(githubToken\)/.test(registry), true);
  check("including Google", /google: Boolean\(googleAccessToken\)/.test(registry), true);
  check("the route says whether each account could be connected at all",
    /githubOAuthAvailable: githubOAuthConfigured\(\)/.test(route), true);
  check("for Google too", /googleOAuthAvailable: googleOAuthConfigured\(\)/.test(route), true);

  /* `test_service` promised to "actually call a connected service". It could
     only call model providers, which are the services nobody was asking about. */
  /* ── The prompt-side twin ────────────────────────────────────────────────
     The tool was one source of the false claim. The other was a prompt block
     that described committing to this app's repository whenever someone asked
     about the app — with no reference to whether any GitHub credential existed.
     Which repository this app is remains true either way; what it can do to
     that repository does not. */
  check("which repository this app is, is stated either way",
    selfRepoKnowledge({ canCommit: false }).includes("shaya99stern-hash/navi-pwa"), true);
  check("but writing to it is claimed only when the tool is there",
    selfRepoKnowledge({ canCommit: false }).includes("land on a branch and open a pull request"), false);
  check("and its absence names the missing credential",
    selfRepoKnowledge({ canCommit: false }).includes("GITHUB_PAT"), true);
  check("while a turn that can commit is told how commits reach production",
    selfRepoKnowledge({ canCommit: true }).includes("not live until that pull request is merged"), true);
  check("the route ties the claim to the tool rather than to the question",
    /canCommit: toolNames\.includes\("commit_own_source"\)/.test(route), true);

  check("test_service plans a probe rather than hunting for a model adapter",
    /const plan = planProbe\(entry, \{ githubToken \}\)/.test(envTools), true);
  check("and the registry hands it the account's own token",
    /githubToken,\n {6}connections: \{/.test(registry), true);
  check("and reports the reason when one cannot be made",
    /if \(plan\.kind === "none"\) return describeProbe/.test(envTools), true);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

void main();
