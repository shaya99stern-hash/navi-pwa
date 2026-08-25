import { numberEnvironment, readCatalogCache, timeoutSignal, writeCatalogCache } from "./catalog";
import { PROVIDERS, modelsProbe, providerApiKey } from "./provider-registry";
import { configuredRouteModels } from "./providers";
import { catalogueModelIds, knownCatalogues, recordCatalogue } from "./route-health";
import type { ProviderRoute } from "./types";

/**
 * Discover which free models OpenRouter is serving right now.
 *
 * The alternative — a hardcoded list — is how this app shipped a dependency
 * that had been retired upstream. A list written today is wrong within months,
 * and nothing in the app notices until a request fails.
 *
 * Two safety properties matter more than coverage here, because a wrong answer
 * from this module would route real requests at a model that costs money or
 * does not exist:
 *
 * 1. **Default-deny.** An entry is treated as free only if it proves it. A
 *    field we cannot parse, a shape we did not expect, a missing price — all
 *    resolve to "not free", which means "not used".
 * 2. **Additive only.** Discovery contributes candidates. It never removes,
 *    replaces, or reorders a route that works today, so discovery returning
 *    nothing leaves the app behaving exactly as it did before.
 *
 * The primary free signal is the `:free` suffix on the model id, which is part
 * of the identity we would send in the request anyway — it cannot drift out of
 * sync with the catalogue the way a separate pricing field can. Price is read
 * as confirmation and is only ever allowed to *reject* a candidate, never to
 * promote one.
 *
 * **Outstanding verification.** The catalogue's exact field names could not be
 * checked against the provider's own documentation from the build environment —
 * the host is unreachable there. Every field this module reads is therefore
 * read defensively, from several plausible names, and a field it fails to find
 * costs a candidate rather than producing a wrong one. Confirming the shape
 * against the live endpoint would let the parsing tighten; nothing breaks until
 * then, it just discovers fewer models.
 */

const CACHE_KEY = "openrouter:free-models";
/** Thirty minutes, per the spec. Long enough to be free, short enough to track. */
const DEFAULT_TTL_MS = 30 * 60_000;
const DISCOVERY_TIMEOUT_MS = 4_500;

export type DiscoveredModel = {
  id: string;
  contextLength: number;
  /** Only ever true when the entry proved it. */
  free: boolean;
};

export type DiscoveryResult = {
  models: DiscoveredModel[];
  /** Where these came from, for diagnostics. */
  source: "live" | "cache" | "stale-fallback";
};

/**
 * The stale-safe path, used only when discovery fails.
 *
 * Marked stale on purpose: these are ids that were correct when written and
 * carry no guarantee beyond that. They exist so a catalogue outage degrades to
 * yesterday's routing instead of to no routing, and they are deliberately the
 * long-established weights rather than the leading edge — old and still served
 * beats new and renamed.
 */
const STALE_FALLBACK_IDS = [
  "deepseek/deepseek-r1:free",
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free"
];

/**
 * What a free model on this catalogue looks like, per capability.
 *
 * Kept as config rather than a ranked list of ids for the same reason the ids
 * are not hardcoded: the specific model that best serves "coding" changes, but
 * the shape of the question does not.
 */
const CAPABILITY_PATTERNS: Record<"coding" | "reasoning" | "long-context", RegExp> = {
  coding: /coder|code|qwen3?-coder|devstral/i,
  reasoning: /r1|reason|think|deepseek-v[3-9]|gpt-oss/i,
  "long-context": /glm|qwen|llama|gemma/i
};

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  /* Catalogues commonly serialise prices as decimal strings to avoid float
     rounding. A string that is not a number stays null, which reads as
     "unproven" and therefore "not free". */
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Whether an entry's price contradicts the free suffix.
 *
 * Returns true only when a price was found *and* it is above zero. An
 * unreadable or absent price is not evidence of cost, so it does not reject —
 * the `:free` suffix already carried the claim. This is the one place the
 * module is deliberately permissive, and it is safe because the suffix is part
 * of the model id: a model whose id says `:free` is billed as free by the
 * provider, whatever this object happens to look like.
 */
function pricedAboveZero(entry: Record<string, unknown>): boolean {
  const pricing = entry.pricing;
  if (!pricing || typeof pricing !== "object") return false;
  const record = pricing as Record<string, unknown>;
  for (const field of ["prompt", "completion", "input", "output", "request"]) {
    const price = numberFrom(record[field]);
    if (price !== null && price > 0) return true;
  }
  return false;
}

function contextLengthOf(entry: Record<string, unknown>): number {
  for (const field of ["context_length", "contextLength", "max_context_length"]) {
    const value = numberFrom(entry[field]);
    if (value !== null && value > 0) return value;
  }
  const top = entry.top_provider;
  if (top && typeof top === "object") {
    const value = numberFrom((top as Record<string, unknown>).context_length);
    if (value !== null && value > 0) return value;
  }
  return 0;
}

export function normalizeDiscoveredModel(value: unknown): DiscoveredModel | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = entry.id;
  if (typeof id !== "string" || !id.includes("/")) return null;

  /* Not a chat model. These share the catalogue and would route a
     conversation at something that cannot hold one. */
  if (/embedding|rerank|moderation|whisper|tts|text-to-image|image-generation/i.test(id)) return null;

  const free = id.endsWith(":free") && !pricedAboveZero(entry);
  return { id, contextLength: contextLengthOf(entry), free };
}

function parseCatalog(body: unknown): DiscoveredModel[] {
  /* Envelope shape is read defensively: `data` is the documented key, but an
     array at the top level costs nothing to accept and means a shape change
     degrades to fewer models rather than to none. */
  const rows = Array.isArray(body) ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data
      : [];
  return rows
    .map(normalizeDiscoveredModel)
    .filter((model): model is DiscoveredModel => Boolean(model?.free));
}

function staleFallback(): DiscoveryResult {
  return {
    models: STALE_FALLBACK_IDS.map((id) => ({ id, contextLength: 0, free: true })),
    source: "stale-fallback"
  };
}

export async function discoverFreeModels(signal: AbortSignal): Promise<DiscoveryResult> {
  const cached = readCatalogCache<DiscoveredModel[]>(CACHE_KEY);
  if (cached?.fresh) return { models: cached.value, source: "cache" };

  const apiKey = providerApiKey(PROVIDERS.openrouter);
  if (!apiKey) return staleFallback();

  const timed = timeoutSignal(signal, DISCOVERY_TIMEOUT_MS, "Free model discovery timed out.");
  try {
    const response = await fetch(PROVIDERS.openrouter.modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: timed.signal
    });
    if (!response.ok) throw new Error(`The free model catalogue returned ${response.status}.`);
    const models = parseCatalog(await response.json());
    /* An empty parse is a failed parse. Caching it would hold the app in a
       degraded state for the whole TTL over what may be a transient shape. */
    if (!models.length) throw new Error("The free model catalogue returned no usable entries.");

    writeCatalogCache(CACHE_KEY, models, numberEnvironment("NAVI_MODEL_CATALOG_TTL_MS", DEFAULT_TTL_MS, 60_000, 6 * 60 * 60_000));
    return { models, source: "live" };
  } catch (error) {
    console.warn("Navi Soul could not refresh the free model catalogue:", error);
    /* Expired beats invented: a catalogue from an hour ago describes models
       that existed an hour ago, which the hardcoded list cannot promise. */
    if (cached?.value.length) return { models: cached.value, source: "cache" };
    return staleFallback();
  } finally {
    timed.dispose();
  }
}

export function rankForCapability(models: DiscoveredModel[], capability: keyof typeof CAPABILITY_PATTERNS): DiscoveredModel[] {
  const pattern = CAPABILITY_PATTERNS[capability];
  return [...models]
    .filter((model) => model.free)
    .sort((a, b) => {
      const matched = Number(pattern.test(b.id)) - Number(pattern.test(a.id));
      if (matched) return matched;
      // Among equals, more context is strictly better for the lanes using this.
      return b.contextLength - a.contextLength;
    });
}

function routeFor(model: DiscoveredModel, capability: keyof typeof CAPABILITY_PATTERNS): ProviderRoute {
  return {
    provider: "openrouter",
    model: model.id,
    /* Reaches the status stream, so it names the product and never the
       provider or the underlying model. */
    label: "Navi Soul",
    capability
  };
}

/**
 * The best free route for a capability, from cache only.
 *
 * Synchronous on purpose. Blocking a request on a catalogue lookup trades time
 * to first token — the thing users actually feel — for a marginally better
 * model choice, which is the wrong trade every time. A cold cache returns null,
 * the caller keeps the route it already had, and `refreshFreeModels` warms the
 * cache for the next request.
 */
export function cachedRoute(capability: keyof typeof CAPABILITY_PATTERNS): ProviderRoute | null {
  const cached = readCatalogCache<DiscoveredModel[]>(CACHE_KEY);
  if (!cached?.fresh) return null;
  const best = rankForCapability(cached.value, capability)[0];
  return best ? routeFor(best, capability) : null;
}

/**
 * Warm the catalogue without making anyone wait for it.
 *
 * Deliberately not awaited by the request path, and deliberately swallowing its
 * own failures: a catalogue that cannot be read is a slightly worse model
 * choice, never a failed answer.
 */
export function refreshFreeModels(signal: AbortSignal): void {
  const cached = readCatalogCache<DiscoveredModel[]>(CACHE_KEY);
  if (cached?.fresh) return;
  void discoverFreeModels(signal).catch(() => {});
}

/**
 * Learn which of the configured route models each provider actually serves.
 *
 * Deliberately unawaited by the request path and deliberately silent about its
 * own failures, exactly like `refreshFreeModels` above: a catalogue that cannot
 * be read leaves every route exactly as usable as it was, which is the only
 * safe direction. See `route-health.ts` for why unknown must not mean dead.
 *
 * One request per provider per hour, at most.
 */
export function refreshRouteHealth(signal: AbortSignal): void {
  const configured = configuredRouteModels();
  if (!configured.length) return;
  /* Nothing to learn while the last answer is still fresh. */
  if (Object.keys(knownCatalogues()).length >= configured.length) return;

  void (async () => {
    await Promise.allSettled(configured.map(async (entry) => {
      const adapter = PROVIDERS[entry.provider];
      const key = providerApiKey(adapter);
      if (!key) return;
      const probe = modelsProbe(adapter, key);
      const response = await fetch(probe.url, { headers: probe.headers, signal, cache: "no-store" });
      if (!response.ok) return;
      recordCatalogue(entry.provider, catalogueModelIds(await response.json()));
    }));
  })().catch(() => {});
}

/** Awaited discovery, for diagnostics and tests rather than the request path. */
export async function discoverRoute(options: {
  capability: keyof typeof CAPABILITY_PATTERNS;
  signal: AbortSignal;
}): Promise<ProviderRoute | null> {
  const { models } = await discoverFreeModels(options.signal);
  const best = rankForCapability(models, options.capability)[0];
  return best ? routeFor(best, options.capability) : null;
}
