const serverOnly = require.resolve("server-only");
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as unknown as NodeModule;

const {
  describeFactsConfigGap, factsBlock, factsConfigured, forgetFact, listFacts, rememberFact
} = require("../lib/memory/facts") as typeof import("../lib/memory/facts");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const clear = () => { for (const k of KEYS) delete process.env[k]; };

async function main() {
  /* ---- Configuration ------------------------------------------------- */
  clear();
  check("nothing set is unconfigured", factsConfigured(), false);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  check("a url alone is not enough", factsConfigured(), false);
  check("the gap names the missing key", /ANON_KEY/.test(describeFactsConfigGap() ?? ""), true);
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  check("both halves configure it", factsConfigured(), true);
  check("no gap when configured", describeFactsConfigGap(), null);

  /* http:// would send a Clerk token over the clear. */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x.supabase.co";
  check("an insecure url is rejected", factsConfigured(), false);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";

  clear();
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  check("server-side aliases work", factsConfigured(), true);

  /* ---- Memory is an enhancement, never a precondition ----------------- */
  clear();
  /* Unconfigured must be silence, not a throw: an answer without a remembered
     preference is worth far more than an error card. */
  check("listing without storage yields nothing", await listFacts("token"), []);
  check("remembering without storage yields nothing", await rememberFact("token", "user_1", "I use TypeScript"), null);
  check("forgetting without storage reports failure", await forgetFact("token", "11111111-1111-1111-1111-111111111111"), false);

  /* An id that is not a uuid must never reach the query string. */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  check("a non-uuid id is refused before any request", await forgetFact("token", "1 or 1=1"), false);
  check("an empty id is refused", await forgetFact("token", ""), false);
  clear();

  /* Whitespace is not a fact, and must not create an empty row. */
  check("blank text is not remembered", await rememberFact("token", "user_1", "   "), null);

  /* ---- The prompt block ---------------------------------------------- */
  check("no facts render nothing", factsBlock([]), "");
  const block = factsBlock([
    { id: "a", fact: "Uses TypeScript", sourceChatId: null, updatedAt: "2026-01-01" },
    { id: "b", fact: "Timezone is ET", sourceChatId: "c1", updatedAt: "2026-01-02" }
  ]);
  check("each fact appears", block.includes("Uses TypeScript") && block.includes("Timezone is ET"), true);
  check("facts are a list, not prose", (block.match(/^- /gm) ?? []).length, 2);
  /* Two failure modes worth naming: treating a stale fact as gospel when the
     conversation says otherwise, and announcing a remembered fact as a
     discovery. */
  check("the block yields to the conversation", /unless this conversation contradicts/i.test(block), true);
  check("the block forbids presenting it as new", /never present one back/i.test(block), true);
  /* It must not leak the source chat id into the model's context. */
  check("no internal ids reach the prompt", block.includes("c1"), false);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

/* ---- The table the code has always assumed existed ---------------------- */

/**
 * `facts.ts` has referenced `navi_memory_facts` since facts shipped, and no
 * migration for it existed in this repository. The other migration's header
 * even described its RLS as "same as navi_memory_facts" — a table nothing here
 * created. Anyone rebuilding the database from these files got a deployment
 * where every fact read and write failed silently, forever.
 *
 * These assert the schema against what the code actually sends, because a
 * migration that disagrees with its caller is the same outage with more steps.
 */
function migrations(): string {
  const { readdirSync, readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const dir = join(process.cwd(), "supabase/migrations");
  return readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}

const sql = migrations();

check("a migration creates the facts table",
  /create table if not exists public\.navi_memory_facts/.test(sql), true);
/* `rememberFact` sends `on_conflict=user_id,fact`. ON CONFLICT can only use an
   index covering exactly those columns in that order, so this pairing is not
   style — a mismatch fails every write with a 42P10 and nothing else explains
   it. The unique index and the query string have to be read together. */
check("its unique constraint matches the on_conflict the code sends",
  /unique \(user_id, fact\)/.test(sql), true);
check("and that is the string the code sends",
  /on_conflict=user_id,fact/.test(require("node:fs").readFileSync(require("node:path").join(process.cwd(), "lib/memory/facts.ts"), "utf8")), true);
check("row-level security is enabled on it",
  /alter table public\.navi_memory_facts enable row level security/.test(sql), true);
check("with a policy per operation, keyed to the Clerk subject",
  (sql.match(/on public\.navi_memory_facts for (?:select|insert|update|delete)/g) ?? []).length, 4);

/* The gap that made this invisible: diagnostics probed one of the two memory
   tables and reported the answer as "Cloud memory". Skills had a migration and
   facts did not, so the single likeliest broken state was the one state the
   check could not see. */
const diagnostics = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "lib/ai/diagnostic-tools.ts"), "utf8");
check("the cloud memory check probes the skills table", /navi_learned_skills/.test(diagnostics), true);
check("and the facts table too", /navi_memory_facts/.test(diagnostics), true);

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

/* A module, not a script. With only `require` and no import or export,
   TypeScript scopes these declarations globally, so two such test files
   collide on `pass`, `check`, and everything else. */
export {};
