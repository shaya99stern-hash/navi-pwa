/**
 * Spend protection for optional metered routes.
 *
 * NaviOS is zero-dollar by default. Paid inference is dormant unless an
 * operator explicitly opts in with NAVI_ALLOW_PAID_MODELS=true and also sets a
 * positive monthly budget. Free-tier routing does not depend on this ledger.
 *
 * If paid inference is ever intentionally enabled, the ledger still prices
 * from real usage, assumes the expensive interpretation of ambiguous usage,
 * and refuses to call a cap "hard" unless the store survives serverless
 * instance restarts.
 */

export type TokenUsage = {
  /** Prompt tokens served from the provider's prefix cache. Roughly free. */
  cacheHitTokens: number;
  /** Prompt tokens that had to be processed. */
  cacheMissTokens: number;
  outputTokens: number;
};

export type SpendTier = "flash" | "pro";

type RateCard = { cacheHit: number; cacheMiss: number; output: number };

const BASE_RATES: Record<SpendTier, RateCard> = {
  flash: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  pro: { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 }
};

/** Price pessimistically if paid inference has been deliberately enabled. */
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
 * An unreadable usage shape must never be interpreted as free. If cache detail
 * is absent, all prompt tokens are counted as misses.
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
  return { cacheHitTokens: 0, cacheMissTokens: prompt, outputTokens: output };
}

/* ── The ledger's storage ─────────────────────────────────────────────────── */

export type SpendStore = {
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

/* ── Zero-dollar policy and optional paid ceiling ─────────────────────────── */

/**
 * Financial default: zero. This is intentionally separate from per-turn token
 * and step envelopes, which exist to fit free-provider rate limits and make the
 * app faster; they are not a money budget.
 */
export const DEFAULT_BUDGET_USD = 0;
const DEGRADE_AT = 0.8;

export function paidModelsExplicitlyEnabled(): boolean {
  return process.env.NAVI_ALLOW_PAID_MODELS === "true";
}

export function monthlyBudget(): number {
  const value = Number(process.env.NAVI_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUDGET_USD;
}

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
 * A metered lane is impossible by default. It requires all of:
 * 1. NAVI_ALLOW_PAID_MODELS=true
 * 2. a positive NAVI_MONTHLY_BUDGET_USD
 * 3. a durable ledger, unless the operator separately accepts an unenforced cap
 *
 * Missing or malformed configuration always falls toward $0, never toward
 * spending.
 */
export function meteredLaneEnabled(store: SpendStore): boolean {
  if (!paidModelsExplicitlyEnabled()) return false;
  if (monthlyBudget() <= 0) return false;
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
  const spent = await store.read(ledgerKey()).catch(() => budget);
  return { spent, budget, state: budgetState(spent, budget), durable: store.durable };
}

export async function recordSpend(usage: TokenUsage, tier: SpendTier): Promise<void> {
  if (!paidModelsExplicitlyEnabled()) return;
  const cost = costOf(usage, tier);
  if (cost <= 0) return;
  const store = getSpendStore();
  await store.add(ledgerKey(), cost).catch((error) => {
    console.error("Navi Soul could not record spend against the monthly budget:", error);
  });
}

/** Rendered in Settings → Account. Never in a chat. */
export function formatSpend(snapshot: SpendSnapshot): string {
  return `$${snapshot.spent.toFixed(2)} of $${snapshot.budget.toFixed(2)} this month`;
}
