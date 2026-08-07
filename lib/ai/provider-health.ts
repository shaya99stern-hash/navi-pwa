import type { ProviderName, ProviderRoute } from "./types";

/**
 * Cross-request memory of which providers are currently failing.
 *
 * The fallback loop already recovers within a request, but it forgot between
 * them: a provider that had just returned three 403s was still first in line
 * for the next request, so every single turn paid that provider's timeout
 * before reaching one that worked. That is the "loading failure" a user
 * actually feels — not the error, the wait.
 *
 * A provider that fails repeatedly enters a cooldown and is *deprioritized*,
 * never dropped: if everything is cooling, everything is still tried, because
 * a guess at a cooling provider beats a guaranteed refusal. One success
 * clears the record — providers recover, and holding a grudge against a
 * recovered one wastes exactly the capacity this exists to protect.
 */

type Health = { failures: number; cooldownUntil: number };

const globalHealthState = globalThis as typeof globalThis & {
  __naviProviderHealth?: Map<ProviderName, Health>;
};

function healthMap(): Map<ProviderName, Health> {
  return (globalHealthState.__naviProviderHealth ??= new Map());
}

/** Failures before a provider starts cooling. One failure is weather. */
const FAILURES_BEFORE_COOLDOWN = 2;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

export function markProviderFailure(provider: ProviderName): void {
  const map = healthMap();
  const entry = map.get(provider) ?? { failures: 0, cooldownUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= FAILURES_BEFORE_COOLDOWN) {
    const backoff = BASE_COOLDOWN_MS * 2 ** (entry.failures - FAILURES_BEFORE_COOLDOWN);
    entry.cooldownUntil = Date.now() + Math.min(backoff, MAX_COOLDOWN_MS);
  }
  map.set(provider, entry);
}

export function markProviderSuccess(provider: ProviderName): void {
  healthMap().delete(provider);
}

export function isProviderCooling(provider: ProviderName): boolean {
  const entry = healthMap().get(provider);
  return Boolean(entry && entry.cooldownUntil > Date.now());
}

/**
 * Healthy routes first, cooling routes last, order otherwise preserved.
 * A stable partition rather than a filter: nothing is ever unreachable.
 */
export function orderRoutesByHealth<T extends ProviderRoute>(routes: T[]): T[] {
  const healthy: T[] = [];
  const cooling: T[] = [];
  for (const route of routes) (isProviderCooling(route.provider) ? cooling : healthy).push(route);
  return [...healthy, ...cooling];
}

/** For diagnostics surfaces. Empty when everything is healthy. */
export function coolingProviders(): ProviderName[] {
  const now = Date.now();
  return [...healthMap().entries()]
    .filter(([, entry]) => entry.cooldownUntil > now)
    .map(([provider]) => provider);
}

/** Test hook: a fresh slate without reaching into the global. */
export function resetProviderHealth(): void {
  healthMap().clear();
}
