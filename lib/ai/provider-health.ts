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

type Health = { failures: number; cooldownUntil: number; rejected?: boolean };

const globalHealthState = globalThis as typeof globalThis & {
  __naviProviderHealth?: Map<ProviderName, Health>;
};

/**
 * Did this failure mean "your key is not welcome here"?
 *
 * A rate limit and a revoked credential both arrive as a failed request, and
 * treating them the same is what let a dead Cerebras key sit in the routing
 * table reporting green for weeks: it was tried, it 403'd, it cooled for thirty
 * seconds, and it came back to the front of the line to fail again. A cooldown
 * is the right response to weather and the wrong one to a key that will never
 * work again until someone replaces it.
 *
 * Matched on the text because that is what the SDK gives us — it wraps the
 * provider's response and every provider words it differently. Deliberately
 * narrow: a false positive here reports a working key as dead, which is a worse
 * error than missing one, so nothing ambiguous is included. `429` is
 * conspicuously absent — being rate-limited is proof the key is *good*.
 */
export function isCredentialRejection(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message) return false;
  if (message.includes("429") || message.includes("rate limit") || message.includes("quota")) return false;
  return /\b(401|403)\b/.test(message)
    || message.includes("unauthorized")
    || message.includes("forbidden")
    || message.includes("invalid api key")
    || message.includes("invalid_api_key")
    || message.includes("authentication");
}

function healthMap(): Map<ProviderName, Health> {
  return (globalHealthState.__naviProviderHealth ??= new Map());
}

/** Failures before a provider starts cooling. One failure is weather. */
const FAILURES_BEFORE_COOLDOWN = 2;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

/**
 * Record a failed attempt, and what kind of failure it was.
 *
 * The error is optional so existing call sites keep working, but passing it is
 * what separates "this provider is having a bad minute" from "this key is
 * dead" — see `isCredentialRejection`. A rejected credential cools immediately
 * rather than waiting for a second failure: there is no point spending another
 * request to confirm what the provider just said plainly.
 */
export function markProviderFailure(provider: ProviderName, error?: unknown): void {
  const map = healthMap();
  const entry = map.get(provider) ?? { failures: 0, cooldownUntil: 0 };
  entry.failures += 1;
  if (error !== undefined && isCredentialRejection(error)) entry.rejected = true;
  if (entry.rejected || entry.failures >= FAILURES_BEFORE_COOLDOWN) {
    const backoff = BASE_COOLDOWN_MS * 2 ** (Math.max(entry.failures, FAILURES_BEFORE_COOLDOWN) - FAILURES_BEFORE_COOLDOWN);
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

/**
 * Providers that have refused this deployment's credential.
 *
 * Survives the cooldown on purpose. A cooling provider is expected back in
 * thirty seconds; a rejected one needs a person to paste a new key, and until
 * they do, every surface that says "configured" is lying. Cleared only by
 * `markProviderSuccess`, so a replaced key clears it on its first real use.
 */
export function rejectedProviders(): ProviderName[] {
  return [...healthMap().entries()].filter(([, entry]) => entry.rejected).map(([provider]) => provider);
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
