import { readCatalogCache, writeCatalogCache } from "./catalog";
import { getSpendStore, ledgerKey } from "./spend";

/**
 * Keeping web search inside its free allotment.
 *
 * The provider's free tier is a fixed number of calls a month. Without a
 * ceiling and a cache, a handful of real users exhausts it and search stops
 * working for everyone — which surfaces as Navi Soul quietly getting worse at
 * current events, with nothing to say why.
 *
 * Two mechanisms, in the order that matters:
 *
 * 1. **Cache first.** The same question asked twice in an hour is one call, not
 *    two. This is the cheaper win by a wide margin: repeated and near-repeated
 *    queries are most of the traffic a chat app generates.
 * 2. **Then a ceiling.** At 90% of the month's allotment the tool switches off
 *    and Navi Soul answers from its own knowledge. Silently — a person asking
 *    about last week's news does not want a billing notice, and the answer
 *    without search is still an answer.
 */

/** The free tier's monthly call allowance. */
const MONTHLY_CALLS = 1_000;
/** Switch off here, not at 100%, so the last calls are headroom rather than a cliff. */
const DISABLE_AT = 0.9;
/** An hour, per the spec. Long enough to matter, short enough to stay current. */
const CACHE_TTL_MS = 60 * 60_000;

function allowance(): number {
  const value = Number(process.env.NAVI_SEARCH_MONTHLY_CALLS);
  return Number.isFinite(value) && value > 0 ? value : MONTHLY_CALLS;
}

/**
 * Queries that differ only in punctuation, case, or spacing are the same
 * question. Normalising before the cache lookup is most of what makes the
 * cache worth having.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function cacheKey(query: string): string {
  return `navi:search:${normalizeQuery(query)}`;
}

/** Counted per calendar month, sharing the ledger key the spend ceiling uses. */
function counterKey(): string {
  return `${ledgerKey()}:search`;
}

export function readCachedSearch(query: string): string | null {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  const cached = readCatalogCache<string>(cacheKey(query));
  return cached?.fresh ? cached.value : null;
}

export function cacheSearch(query: string, result: string): void {
  const normalized = normalizeQuery(query);
  if (!normalized || !result) return;
  writeCatalogCache(cacheKey(query), result, CACHE_TTL_MS);
}

/**
 * Whether another live search may run.
 *
 * An unreadable counter reads as *available*, which is the opposite of the
 * spend ceiling's rule and deliberately so: the worst case here is overrunning
 * a free quota and search degrading, while the worst case there is a bill. The
 * safe direction is not the same in both places.
 */
export async function searchAllowed(): Promise<boolean> {
  const used = await getSpendStore().read(counterKey()).catch(() => 0);
  return used < allowance() * DISABLE_AT;
}

/** Record one live call. Cached answers do not count, because they cost nothing. */
export async function recordSearch(): Promise<void> {
  await getSpendStore().add(counterKey(), 1).catch((error) => {
    console.warn("Navi Soul could not record a search against the monthly allowance:", error);
  });
}

/** For the diagnostics surface. Never shown in a chat. */
export async function searchUsage(): Promise<{ used: number; allowance: number; enabled: boolean }> {
  const used = await getSpendStore().read(counterKey()).catch(() => 0);
  const limit = allowance();
  return { used, allowance: limit, enabled: used < limit * DISABLE_AT };
}
