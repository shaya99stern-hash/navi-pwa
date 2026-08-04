/**
 * Shared machinery for reading a provider's live model catalogue.
 *
 * Model ids are not stable. They get renamed, retired, and superseded without
 * notice, and the one dead dependency this app shipped got in because an id was
 * copied out of a comparison article and hardcoded. The fix for that class of
 * bug is to ask the provider what it currently serves instead of remembering
 * what it served once.
 *
 * The Hugging Face router catalogue in `swarm-router.ts` was the first of
 * these. This is the same machinery, factored out so the second one — free
 * model discovery — extends it rather than reimplementing the cache, the
 * timeout, and the stale-safe fallback slightly differently.
 */

export function numberEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
}

/**
 * A signal that aborts when the parent does, or when the timeout elapses.
 *
 * Catalogue reads are an optimisation, never the request itself. One that hangs
 * must not spend the answer's budget, so every one of them is bounded.
 */
export function timeoutSignal(
  parent: AbortSignal,
  timeoutMs: number,
  reason = "Model catalogue lookup timed out."
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortParent = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener("abort", abortParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abortParent);
    }
  };
}

type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * Cached on `globalThis` rather than in a module variable because the edge
 * runtime may evaluate this module more than once per isolate. A cache that
 * resets on re-evaluation is a cache that never hits.
 */
const cacheState = globalThis as typeof globalThis & { __naviCatalogCache?: Map<string, CacheEntry<unknown>> };
const caches = cacheState.__naviCatalogCache ?? (cacheState.__naviCatalogCache = new Map());

export function readCatalogCache<T>(key: string): { value: T; fresh: boolean } | null {
  const entry = caches.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return { value: entry.value, fresh: entry.expiresAt > Date.now() };
}

export function writeCatalogCache<T>(key: string, value: T, ttlMs: number): void {
  caches.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Testing seam. Nothing in the request path should need this. */
export function clearCatalogCache(): void {
  caches.clear();
}
