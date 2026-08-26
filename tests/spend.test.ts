import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  budgetState,
  costOf,
  formatSpend,
  ledgerKey,
  meteredLaneEnabled,
  monthlyBudget,
  paidModelsExplicitlyEnabled,
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
check("a million missed input tokens", costOf(million, "flash").toFixed(4), "0.2800");
check("the pro tier costs more", costOf(million, "pro") > costOf(million, "flash"), true);

const cached: TokenUsage = { cacheHitTokens: 1_000_000, cacheMissTokens: 0, outputTokens: 0 };
check("a cache hit is far cheaper than a miss", costOf(cached, "flash") * 40 < costOf(million, "flash"), true);
check("zero usage costs nothing", costOf({ cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0 }, "flash"), 0);

/* ── Reading usage errs expensive ────────────────────────────────────────── */

check("cache fields are read", readUsage({ prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 20, completion_tokens: 5 }), { cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 5 });
check("camelCase fields are read", readUsage({ promptCacheHitTokens: 100, promptCacheMissTokens: 20, outputTokens: 5 }), { cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 5 });
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
check("a zero budget stops", budgetState(0, 0), "stopped");

check("the key is per month", ledgerKey(new Date(Date.UTC(2026, 7, 4))), "navi:spend:2026-08");
check("a new month is a new key", ledgerKey(new Date(Date.UTC(2026, 8, 1))), "navi:spend:2026-09");
check("months are zero padded", ledgerKey(new Date(Date.UTC(2026, 0, 31))), "navi:spend:2026-01");
check("december does not roll the year early", ledgerKey(new Date(Date.UTC(2026, 11, 31))), "navi:spend:2026-12");

/* ── Zero-dollar is the default, paid inference is explicit opt-in ───────── */

const durable: SpendStore = { durable: true, read: async () => 0, add: async () => 0 };
const ephemeral: SpendStore = { durable: false, read: async () => 0, add: async () => 0 };

const oldPaid = process.env.NAVI_ALLOW_PAID_MODELS;
const oldBudget = process.env.NAVI_MONTHLY_BUDGET_USD;
const oldUnmetered = process.env.NAVI_ALLOW_UNMETERED_SPEND;

delete process.env.NAVI_ALLOW_PAID_MODELS;
delete process.env.NAVI_MONTHLY_BUDGET_USD;
delete process.env.NAVI_ALLOW_UNMETERED_SPEND;

check("paid models are off by default", paidModelsExplicitlyEnabled(), false);
check("the default money budget is zero", monthlyBudget(), 0);
check("even a durable ledger cannot enable paid inference by default", meteredLaneEnabled(durable), false);
check("an ephemeral ledger cannot enable paid inference by default", meteredLaneEnabled(ephemeral), false);

process.env.NAVI_ALLOW_PAID_MODELS = "true";
check("paid opt-in without a positive budget still cannot spend", meteredLaneEnabled(durable), false);

process.env.NAVI_MONTHLY_BUDGET_USD = "10";
check("explicit paid opt-in plus a durable ledger can enable the lane", meteredLaneEnabled(durable), true);
check("explicit paid opt-in still refuses an ephemeral ledger", meteredLaneEnabled(ephemeral), false);

process.env.NAVI_ALLOW_UNMETERED_SPEND = "true";
check("an operator can separately accept an unenforced cap", meteredLaneEnabled(ephemeral), true);
process.env.NAVI_ALLOW_UNMETERED_SPEND = "";
check("anything other than an explicit unmetered yes keeps it off", meteredLaneEnabled(ephemeral), false);

if (oldPaid === undefined) delete process.env.NAVI_ALLOW_PAID_MODELS; else process.env.NAVI_ALLOW_PAID_MODELS = oldPaid;
if (oldBudget === undefined) delete process.env.NAVI_MONTHLY_BUDGET_USD; else process.env.NAVI_MONTHLY_BUDGET_USD = oldBudget;
if (oldUnmetered === undefined) delete process.env.NAVI_ALLOW_UNMETERED_SPEND; else process.env.NAVI_ALLOW_UNMETERED_SPEND = oldUnmetered;

check("spend reads as money", formatSpend({ spent: 2.14, budget: 10, state: "ok", durable: true }), "$2.14 of $10.00 this month");
check("a fresh month reads as zero", formatSpend({ spent: 0, budget: 10, state: "ok", durable: true }), "$0.00 of $10.00 this month");

/* ── A paid route cannot be reached by free fallbacks ───────────────────── */

const all: ProviderAvailability = { gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true, mistral: true, deepseek: true, together: true, nvidia: true, sambanova: true };
const noTools = { web: false, code: false, artifacts: true };

check("exactly one provider is marked metered in the current registry", Object.values(PROVIDERS).filter((adapter) => adapter.costPerMTok > 0).length, 1);

for (const primary of [ROUTES.geminiSynthesis, ROUTES.groqFast, ROUTES.cerebrasLarge, ROUTES.hfGptOss, ROUTES.openRouterReasoning, ROUTES.mistralBalanced]) {
  const alternates = fallbackRoutes({ primary, availability: all, complex: true });
  check(`a failing ${primary.provider} never falls back to the paid lane`, alternates.some((route) => route.provider === "deepseek"), false);
}

for (const lane of [1, 2, 4] as const) {
  const route = routeForLane({ lane, availability: all, tools: noTools, hasFiles: false, meteredAllowed: true });
  check(`lane ${lane} never spends`, route?.provider === "deepseek", false);
}

/* The router still knows how to use a paid route when a caller deliberately
   passes meteredAllowed=true. The application-level zero-dollar gate above is
   what makes that permission false by default. */
check("lane 3 can use the paid route only when explicitly permitted", routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: true })?.provider, "deepseek");
check("lane 3 falls back to free when paid permission is false", routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: false })?.provider === "deepseek", false);
check("lane 3 still answers when paid permission is false", Boolean(routeForLane({ lane: 3, availability: all, tools: noTools, hasFiles: false, meteredAllowed: false })?.model), true);
check("lane 3 does not spend when the key is absent", routeForLane({ lane: 3, availability: { ...all, deepseek: false, together: false, nvidia: false, sambanova: false }, tools: noTools, hasFiles: false, meteredAllowed: true })?.provider === "deepseek", false);

for (const route of [ROUTES.deepseekFlash, ROUTES.deepseekPro]) {
  check(`${route.model} is not a deprecated alias`, /^deepseek-(chat|reasoner)$/.test(route.model), false);
  check(`${route.model} is not labelled with the provider`, /deepseek/i.test(route.label), false);
}

/* ── Prefix caching depends on ordering, so the ordering is asserted ─────── */

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
