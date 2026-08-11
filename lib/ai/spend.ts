/**
 * The spend ceiling for the one metered lane.
 *
 * Built before the provider it guards, deliberately. A model that can loop tool
 * calls can loop spend, and a budget added afterwards is a budget added after
 * the first surprise bill.
 *
 * Three things this gets right that a naive counter would not:
 *
 * 1. **Cost comes from the usage object, never from request counts.** Every
 *    response reports how many prompt tokens hit the cache and how many missed,
 *    and those differ by roughly fifty times in price. Estimating from request
 *    counts would be wrong by orders of magnitude in either direction.
 * 2. **Pricing is pessimistic.** The provider has announced peak-hour pricing
 *    at double the base rate with no confirmed effective date. Rather than
 *    guess which window a request landed in, every request is billed to the
 *    ledger at the higher rate. The ledger can then only ever *over*-count,
 *    which means the budget can be underspent but never blown.
 * 3. **A cap is only hard if the ledger is durable.** Serverless instances come
 *    and go; an in-memory counter resets with them, so on its own it cannot
 *    enforce anything. Rather than call that a hard cap, the lane refuses to
 *    turn on without either a durable store or an explicit acknowledgement.
 */

export type TokenUsage = {
  /** Prompt tokens served from the provider's prefix cache. Roughly free. */
  cacheHitTokens: number;
  /** Prompt tokens that had to be processed. The expensive half. */
  cacheMissTokens: number;
  outputTokens: number;
};

export type SpendTier = "flash" | "pro";

/**
 * USD per million tokens, from the provider's own pricing page dated
 * 2026-07-31. Overridable by environment so a published price change is a
 * configuration edit rather than a deploy, and so an operator who sees a
 * surprise on their invoice can correct the ledger immediately.
 */
type RateCard = { cacheHit: number; cacheMiss: number; output: number };

const BASE_RATES: Record<SpendTier, RateCard> = {
  flash: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  pro: { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 }
};

/**
 * Peak-hour pricing is announced at double the base rate, and the effective
 * date is not published. Billing the ledger at the peak rate always costs
 * nothing real — it only makes the ceiling arrive sooner than the invoice.
 */
const PESSIMISTIC_MULTIPLIER = 2;

function rateFor(tier: SpendTier): RateCard {
  const base = BASE_RATES[tier];
  const override = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const prefix = `DEEPSEEK_RATE_${tier.toUpperCase()}`;
  return {
    cacheHit: override(`${prefix}_CACHE_HIT`, base.cacheHit),
    cacheMiss: override(`${prefix}_CACHE_MISS`, base.cacheMiss),
    output: override(`${prefix}_OUTPUT`, base.output)
  };
}

/** What this request costs the ledger, in USD, priced pessimistically. */
export function costOf(usage: TokenUsage, tier: SpendTier): number {
  const rate = rateFor(tier);
  const perToken = (rate.cacheHit * usage.cacheHitTokens)
    + (rate.cacheMiss * usage.cacheMissTokens)
    + (rate.output * usage.outputTokens);
  return (perToken / 1_000_000) * PESSIMISTIC_MULTIPLIER;
}

/**
 * Read usage off a provider response.
 *
 * Field names vary between the OpenAI-compatible shape and the provider's own
 * extensions, and an unreadable usage object must not read as "this request was
 * free". Anything unparseable falls back to the total prompt tokens counted as
 * cache *misses* — the expensive reading — so a shape change makes the ledger
 * cautious rather than blind.
 */
export function readUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

  const output = num(record.completion_tokens) || num(record.output_tokens) || num(record.outputTokens);
  const hit = num(record.prompt_cache_hit_tokens) || num(record.promptCacheHitTokens);
  const miss = num(record.prompt_cache_miss_tokens) || num(record.promptCacheMissTokens);

  if (hit || miss) return { cacheHitTokens: hit, cacheMissTokens: miss, outputTokens: output };

  const prompt = num(record.prompt_tokens) || num(record.input_tokens) || num(record.inputTokens);
  if (!prompt && !output) return null;
  // Cache fields absent: assume every prompt token missed, which is the
  // expensive assumption and therefore the safe one.
  return { cacheHitTokens: 0, cacheMissTokens: prompt, outputTokens: output };
}

/* ── The ledger's storage ─────────────────────────────────────────────────── */

export type SpendStore = {
  /** True when the store survives an instance restart. */
  durable: boolean;
  read: (key: string) => Promise<number>;
  add: (key: string, amount: number) => Promise<number>;
};

const memoryState = globalThis as typeof globalThis & { __naviSpendLedger?: Map<string, number> };
const memory = memoryState.__naviSpendLedger ?? (memoryState.__naviSpendLedger = new Map());

const memoryStore: SpendStore = {
  durable: false,
  read: async (key) => memory.get(key) ?? 0,
  add: async (key, amount) => {
    const next = (memory.get(key) ?? 0) + amount;
    memory.set(key, next);
    return next;
  }
};

/**
 * A durable ledger over the REST API that Vercel's KV and Upstash integrations
 * both expose. Chosen because it needs no dependency and no TCP socket, which
 * is what makes it usable from the edge runtime at all.
 *
 * Amounts are stored as integer micro-dollars: `INCRBY` is atomic, so two
 * concurrent requests cannot lose an increment the way a read-modify-write
 * would, and integers avoid float drift accumulating across thousands of adds.
 */
function restStore(url: string, token: string): SpendStore {
  const call = async (command: string[]): Promise<number> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`The spend ledger returned ${response.status}.`);
    const body = await response.json() as { result?: unknown };
    const value = Number(body.result);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    durable: true,
    read: async (key) => (await call(["GET", key])) / 1_000_000,
    add: async (key, amount) => (await call(["INCRBY", key, String(Math.round(amount * 1_000_000))])) / 1_000_000
  };
}

export function getSpendStore(): SpendStore {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? restStore(url, token) : memoryStore;
}

/* ── The ceiling ──────────────────────────────────────────────────────────── */

export const DEFAULT_BUDGET_USD = 10;
/** Below this fraction of budget the lane runs; above it, it degrades. */
const DEGRADE_AT = 0.8;

export function monthlyBudget(): number {
  const value = Number(process.env.NAVI_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUDGET_USD;
}

/** One ledger key per calendar month, so the budget rolls without a cron. */
export function ledgerKey(now = new Date()): string {
  return `navi:spend:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BudgetState = "ok" | "degraded" | "stopped";

export function budgetState(spent: number, budget = monthlyBudget()): BudgetState {
  if (budget <= 0) return "stopped";
  if (spent >= budget) return "stopped";
  return spent >= budget * DEGRADE_AT ? "degraded" : "ok";
}

/**
 * Whether the metered lane may run at all.
 *
 * Without a durable ledger the ceiling cannot be enforced across instances, so
 * calling it a hard cap would be a lie. The lane therefore stays off unless the
 * operator either provides a durable store or states in the environment that
 * they accept an unenforced ceiling — which is a reasonable thing to accept
 * while spending the provider's free signup tokens, and an unreasonable thing
 * to have chosen for them.
 */
export function meteredLaneEnabled(store: SpendStore): boolean {
  if (store.durable) return true;
  return process.env.NAVI_ALLOW_UNMETERED_SPEND === "true";
}

export type SpendSnapshot = {
  spent: number;
  budget: number;
  state: BudgetState;
  durable: boolean;
};

export async function readSpend(): Promise<SpendSnapshot> {
  const store = getSpendStore();
  const budget = monthlyBudget();
  /* A ledger that cannot be read is treated as exhausted. The alternative —
     assuming zero — turns an outage into unlimited spend. */
  const spent = await store.read(ledgerKey()).catch(() => budget);
  return { spent, budget, state: budgetState(spent, budget), durable: store.durable };
}

export async function recordSpend(usage: TokenUsage, tier: SpendTier): Promise<void> {
  const cost = costOf(usage, tier);
  if (cost <= 0) return;
  const store = getSpendStore();
  await store.add(ledgerKey(), cost).catch((error) => {
    /* Losing a write means undercounting, which is the one direction that can
       overspend, so it is logged loudly rather than swallowed. */
    console.error("Navi Soul could not record spend against the monthly budget:", error);
  });
}

/** Rendered in Settings → Account. Never in a chat. */
export function formatSpend(snapshot: SpendSnapshot): string {
  return `$${snapshot.spent.toFixed(2)} of $${snapshot.budget.toFixed(2)} this month`;
}
