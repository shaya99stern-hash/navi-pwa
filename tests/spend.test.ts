import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  budgetState,
  costOf,
  formatSpend,
  ledgerKey,
  meteredLaneEnabled,
  readUsage,
  type SpendStore,
  type TokenUsage
} from "@/lib/ai/spend";
import { fallbackRoutes, routeForLane, ROUTES } from "@/lib/ai/providers";
import type { ProviderAvailability } from "@/lib/ai/providers";
import { PROVIDERS } from "@/lib/ai/provider-registry";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Cost comes from real usage, priced pessimistically ──────────────────── */

const million: TokenUsage = { cacheHitTokens: 0, cacheMissTokens: 1_000_000, outputTokens: 0 };
/* $0.14 per million cache-miss input, doubled because peak-hour pricing is
   announced but its effective date is not. Over-counting is free; the ledger
   just reaches the ceiling sooner than the invoice does. */
check("a million missed input tokens", costOf(million, "flash").toFixed(4), "0.2800");
check("the pro tier costs more", costOf(million, "pro") > costOf(million, "flash"), true);

const cached: TokenUsage = { cacheHitTokens: 1_000_000, cacheMissTokens: 0, outputTokens: 0 };
check("a cache hit is far cheaper than a miss", costOf(cached, "flash") * 40 < costOf(million, "flash"), true);
check("zero usage costs nothing", costOf({ cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0 }, "flash"), 0);

/* ── Reading usage errs expensive ────────────────────────────────────────── */

check("cache fields are read", readUsage({ prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 20, completion_tokens: 5 }), { cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 5 });
check("camelCase fields are read", readUsage({ promptCacheHitTokens: 100, promptCacheMissTokens: 20, outputTokens: 5 }), { cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 5 });

/* No cache breakdown means we cannot prove anything was cached, and assuming
   it was would under-bill by roughly fifty times. Assume the expensive case. */
check("absent cache fields count as misses", readUsage({ prompt_tokens: 500, completion_tokens: 10 }), { cacheHitTokens: 0, cacheMissTokens: 500, outputTokens: 10 });
check("an unreadable usage object is null", readUsage("nonsense"), null);
check("an empty usage object is null", readUsage({}), null);
check("null is null", readUsage(null), null);

/* ── The ceiling ─────────────────────────────────────────────────────────── */

check("well under budget runs", budgetState(1, 10), "ok");
check("just under the degrade point runs", budgetState(7.99, 10), "ok");
check("at 80 percent it degrades", budgetState(8, 10), "degraded");
check("between 80 and 100 it degrades", budgetState(9.5, 10), "degraded");
check("at budget it stops", budgetState(10, 10), "stopped");
check("over budget it stops", budgetState(11, 10), "stopped");
// A budget of zero is a deliberate "never spend", not a divide-by-zero.
check("a zero budget stops", budgetState(0, 0), "stopped");

// The ledger key rolls with the calendar month, so no cron has to reset it.
check("the key is per month", ledgerKey(new Date(Date.UTC(2026, 7, 4))), "navi:spend:2026-08");
check("a new month is a new key", ledgerKey(new Date(Date.UTC(2026, 8, 1))), "navi:spend:2026-09");
check("months are zero padded", ledgerKey(new Date(Date.UTC(2026, 0, 31))), "navi:spend:2026-01");
check("december does not roll the year early", ledgerKey(new Date(Date.UTC(2026, 11, 31))), "navi:spend:2026-12");

/* ── A cap is only hard if the ledger is durable ─────────────────────────── */

const durable: SpendStore = { durable: true, read: async () => 0, add: async () => 0 };
const ephemeral: SpendStore = { durable: false, read: async () => 0, add: async () => 0 };

check("a durable ledger enables the lane", meteredLaneEnabled(durable), true);
/* Without a durable ledger the ceiling cannot be enforced across instances, so
   the lane stays off rather than pretending the cap is real. */
check("an ephemeral ledger keeps the lane off", meteredLaneEnabled(ephemeral), false);

process.env.NAVI_ALLOW_UNMETERED_SPEND = "true";
check("the operator can accept an unenforced ceiling", meteredLaneEnabled(ephemeral), true);
process.env.NAVI_ALLOW_UNMETERED_SPEND = "";
check("anything other than an explicit yes keeps it off", meteredLaneEnabled(ephemeral), false);

check("spend reads as money", formatSpend({ spent: 2.14, budget: 10, state: "ok", durable: true }), "$2.14 of $10.00 this month");
check("a fresh month reads as zero", formatSpend({ spent: 0, budget: 10, state: "ok", durable: true }), "$0.00 of $10.00 this month");

/* ── The paid lane is never reached by accident ──────────────────────────── */

const all: ProviderAvailability = { gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true, mistral: true, deepseek: true };
const noTools = { web: false, code: false, artifacts: true };

check("exactly one provider is metered", Object.values(PROVIDERS).filter((adapter) => adapter.costPerMTok > 0).length, 1);

/* The failure that would cost real money: a free lane failing over onto the
   paid one. Fallbacks exist to survive an outage, not to start billing. */
for (const primary of [ROUTES.geminiSynthesis, ROUTES.groqFast, ROUTES.cerebrasLarge, ROUTES.hfGptOss, ROUTES.openRouterReasoning, ROUTES.mistralBalanced]) {
  const alternates = fallbackRoutes({ primary, availability: all, complex: true });
  check(`a failing ${primary.provider} never falls back to the paid lane`, alternates.some((route) => route.provider === "deepseek"), false);
}

// Only Lane 3 may spend, and only with permission.
for (const lane of [1, 2, 4] as const) {
  const route = routeForLane({ lane, availability: all, tools: noTools, hasFiles: false, meteredAllowed: true });
  check(`lane ${lane} never spends`, route?.provider === "deepseek", false);
}

check("lane 3 spends when allowed", routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: true })?.provider, "deepseek");
check("lane 3 falls back to free when the budget is gone", routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: false })?.provider === "deepseek", false);
check("lane 3 still answers when the budget is gone", Boolean(routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: false })?.model), true);
check("lane 3 does not spend when the key is absent", routeForLane({ lane: 3, availability: { ...all, deepseek: false }, tools: noTools, hasFiles: false, meteredAllowed: true })?.provider === "deepseek", false);

/* The deprecated `deepseek-chat` and `deepseek-reasoner` aliases point at
   whatever the vendor decides they point at, which is how a model id turns
   into a surprise. The routes name the model. */
for (const route of [ROUTES.deepseekFlash, ROUTES.deepseekPro]) {
  check(`${route.model} is not a deprecated alias`, /^deepseek-(chat|reasoner)$/.test(route.model), false);
  check(`${route.model} is not labelled with the provider`, /deepseek/i.test(route.label), false);
}


/* ── Prefix caching depends on ordering, so the ordering is asserted ─────────
   A cached prompt prefix bills at roughly one fiftieth of an uncached one, and
   the cache matches on an exact byte prefix. One per-request string placed
   early invalidates everything after it. `constraints` changes every turn and
   used to sit fifth, ahead of the two largest stable blocks — so nothing past
   them could ever cache. This reads the source because the cost of the
   regression is a bill, and it would show up in no behavioural test. */

const routeSource = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
const promptStart = routeSource.indexOf("function systemPrompt(");
const promptEnd = routeSource.indexOf("const CAPABILITY_REQUEST");
const prompt = routeSource.slice(promptStart, promptEnd);

const at = (needle: string) => prompt.indexOf(needle);
check("the stable prefix is first", at("stablePrefix(") > -1, true);
check("nothing per-request precedes the stable prefix", at("stablePrefix(") < at("effortInstruction("), true);
check("app knowledge comes before per-request context", at("APP_KNOWLEDGE") < at("memoryContext ||"), true);
check("constraints come after the architect prompt", at("constraints || \"\"") > at("NAVI_ARCHITECT_PROMPT"), true);
check("constraints come after app knowledge", at("constraints || \"\"") > at("APP_KNOWLEDGE"), true);
check("constraints come after the thread summary", at("constraints || \"\"") > at("threadSummary ?"), true);
check("constraints are the last entry", at("constraints || \"\"") > at("mcpContext ?"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
