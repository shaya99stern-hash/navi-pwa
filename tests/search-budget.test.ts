import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearCatalogCache } from "@/lib/ai/catalog";
import { cacheSearch, normalizeQuery, readCachedSearch, searchAllowed, searchUsage } from "@/lib/ai/search-budget";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The cache is where the saving actually comes from ───────────────────────
   Repeated and near-repeated questions are most of what a chat app generates.
   Normalising before the lookup is most of what makes the cache worth having:
   without it, one changed comma is a second billed call. */

check("case is ignored", normalizeQuery("Next.js Releases"), normalizeQuery("next.js releases"));
check("punctuation is ignored", normalizeQuery("what shipped in Next.js?"), normalizeQuery("what shipped in next js"));
check("spacing is ignored", normalizeQuery("  a   b  "), "a b");
check("different questions stay different", normalizeQuery("react hooks") === normalizeQuery("vue hooks"), false);
check("an empty query normalises to nothing", normalizeQuery("!!!"), "");

clearCatalogCache();
check("a cold cache returns nothing", readCachedSearch("next.js releases"), null);

cacheSearch("What shipped in Next.js?", "1. Release notes\n   https://example.test");
check("a cached answer comes back", Boolean(readCachedSearch("what shipped in next js")), true);
check("a different question misses", readCachedSearch("what shipped in react"), null);

// An empty result is not worth caching, and caching it would mask a recovery.
cacheSearch("empty case", "");
check("an empty result is not cached", readCachedSearch("empty case"), null);

/* ── The ceiling ─────────────────────────────────────────────────────────── */

async function ceiling() {
  const usage = await searchUsage();
  check("a fresh month has room", usage.enabled, true);
  check("the allowance is the free tier's", usage.allowance, 1_000);
  check("nothing has been spent yet", usage.used, 0);
  check("search is allowed when there is room", await searchAllowed(), true);
}

/* ── Read against the source ─────────────────────────────────────────────── */

const root = process.cwd();
const web = readFileSync(join(root, "lib/ai/web-tools.ts"), "utf8");
const budget = readFileSync(join(root, "lib/ai/search-budget.ts"), "utf8");

/* Brave's perpetual free tier was retired in February 2026; a new account gets
   a one-time credit and a card on file with no spend cap. A provider that
   cannot fail closed does not belong in an app whose premise is free tiers. */
check("brave is gone from the provider list", /"brave"/.test(web), false);
check("no brave endpoint remains", /api\.search\.brave\.com/.test(web), false);
check("no brave key is read", /BRAVE_SEARCH_API_KEY/.test(web), false);

check("the cache is consulted before the network", web.indexOf("readCachedSearch(query)") < web.indexOf("await runSearch("), true);
check("the ceiling is checked before the network", web.indexOf("await searchAllowed()") < web.indexOf("await runSearch("), true);
check("only live calls are recorded", web.indexOf("recordSearch()") > web.indexOf("await runSearch("), true);
check("results are cached", web.includes("cacheSearch(query, rendered)"), true);

// Switching off at 90% leaves the last calls as headroom rather than a cliff.
check("the tool switches off before the quota is gone", /DISABLE_AT = 0\.9/.test(budget), true);
check("the cache holds for an hour", /CACHE_TTL_MS = 60 \* 60_000/.test(budget), true);

/* The refusal is written for the model, not the user: a person asking about
   last week's news does not want a billing notice, and the answer without
   search is still an answer. */
const refusalStart = web.indexOf("Web search is unavailable");
// The literal itself, not the comment above it, which does discuss quotas.
const refusal = web.slice(refusalStart, web.indexOf('";', refusalStart));
check("the refusal tells the model to be honest", /could not check anything current/.test(refusal), true);
check("the refusal names no quota to the user", /quota|credit|billing|\$/.test(refusal), false);

/* An unreadable counter reads as available here, which is the opposite of the
   spend ceiling's rule and deliberately so — the worst case there is a bill,
   the worst case here is a degraded answer. */
check("an unreadable counter fails open", /catch\(\(\) => 0\)/.test(budget), true);

// SSRF: a model-supplied URL is untrusted input aimed at our own network.
check("only https is fetchable", web.includes('url.protocol !== "https:"'), true);
check("private addresses are refused", web.includes("isPrivateHostname(url.hostname)"), true);

ceiling().then(() => {
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
