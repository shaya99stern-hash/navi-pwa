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

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

/* A module, not a script. With only `require` and no import or export,
   TypeScript scopes these declarations globally, so two such test files
   collide on `pass`, `check`, and everything else. */
export {};
