"use client";

/**
 * One read of what the server has configured, shared by everything that asks.
 *
 * Two components wanted the same answer and each fetched it: the composer, to
 * know whether sending is possible and what the Integrations sheet should show,
 * and the setup notice, to know whether to appear at all. Both ran on mount and
 * both re-ran on every return to the foreground, so a launch made two identical
 * `no-store` requests and every app switch made two more. Neither knew the
 * other existed.
 *
 * The duplication was invisible in the code — the two fetches are four hundred
 * lines apart in different files — and invisible in use, because the answer was
 * the same both times. It shows up only in a request log.
 *
 * Concurrent callers share one request. A repeat within the freshness window
 * gets the answer already in hand. Anything that could change the answer —
 * returning to the app, coming back online, writing a key — asks again.
 */

export type ProviderStatus = {
  providers?: Record<string, boolean | undefined>;
  providerStack?: { missing?: string[] };
  devTools?: { github?: boolean; vercel?: boolean };
  search?: { configured?: boolean; provider?: string | null };
};

/* Long enough that mounting two components is one request, short enough that
   adding a key and coming back shows it. The events below are the real
   freshness mechanism; this only collapses bursts. */
const FRESH_MS = 20_000;

let inFlight: Promise<ProviderStatus | null> | null = null;
let cachedAt = 0;
let cached: ProviderStatus | null = null;

/** Ask again next time. Call after anything that could change the answer. */
export function invalidateProviderStatus(): void {
  cachedAt = 0;
  cached = null;
}

export function readProviderStatus({ force = false }: { force?: boolean } = {}): Promise<ProviderStatus | null> {
  if (!force && cached && Date.now() - cachedAt < FRESH_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = fetch("/api/models", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<ProviderStatus> : null))
    .then((value) => {
      /* A failed probe is not "nothing is configured" — it is "we do not know".
         Only a real answer is cached, so a blip does not latch the composer
         into looking unusable for the next twenty seconds. */
      if (value) {
        cached = value;
        cachedAt = Date.now();
      }
      return value;
    })
    .catch(() => null)
    .finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Re-read when the answer could have changed, and tell the caller.
 *
 * Both callers had their own copy of this listener pair, which is how the
 * duplication survived: each looked self-contained and correct on its own.
 */
export function watchProviderStatus(onChange: (status: ProviderStatus | null) => void): () => void {
  let cancelled = false;
  const deliver = (status: ProviderStatus | null) => { if (!cancelled) onChange(status); };

  void readProviderStatus().then(deliver);

  const recheck = () => {
    if (document.visibilityState !== "visible") return;
    /* Forced: returning to the app is exactly when a key added elsewhere
       should show up, and that is the case the cache would hide. */
    void readProviderStatus({ force: true }).then(deliver);
  };
  const online = () => { void readProviderStatus({ force: true }).then(deliver); };

  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("online", online);

  return () => {
    cancelled = true;
    document.removeEventListener("visibilitychange", recheck);
    window.removeEventListener("online", online);
  };
}
