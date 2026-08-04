import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderRoute } from "./types";

/**
 * GitHub Models — Lane 3, the rationed one.
 *
 * This is the only route in the app whose quota is small enough to matter per
 * request, so it is the only one with a budget. Everything here exists to keep
 * that budget honest without ever showing a quota error to the user.
 *
 * **The provider is the source of truth.** GitHub answers every request with
 * `x-ratelimit-remaining` and `x-ratelimit-reset`, scoped to the GitHub account
 * — which is the thing that actually runs out. A per-device counter would be
 * wrong the moment the same account is used from a second device: two counters
 * would each believe they had a full day, and both would hit 429 anyway. So
 * nothing is counted locally. The headers are read, cached as a hint, and the
 * 429 is treated as the real signal.
 *
 * The hint lives in module scope, which on Vercel means per-isolate and
 * short-lived. That is the right lifetime for it: it exists only to skip a
 * round trip already known to fail, and a cold isolate simply asks GitHub
 * again. A real header always overwrites the hint; the hint never overrides a
 * header.
 */

export const GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";
const CATALOG_URL = "https://models.github.ai/catalog/models";
const CATALOG_TIMEOUT_MS = 6_000;
/** Long enough that discovery is rare, short enough to notice a renamed model. */
const CATALOG_TTL_MS = 30 * 60 * 1_000;

/**
 * Lane 3 caps hard. GitHub's published ceilings move, so these are the app's
 * own conservative limits rather than a mirror of theirs — staying well under
 * a moving limit is cheaper than tracking it.
 */
export const GITHUB_MODELS_MAX_INPUT_TOKENS = 8_000;
export const GITHUB_MODELS_MAX_OUTPUT_TOKENS = 4_000;

/**
 * Preference order, not a hardcoded catalog.
 *
 * Each entry is tried against the live catalog and the first one actually
 * offered wins, so a retired or renamed id costs a fallback rather than an
 * outage. The list is only consulted when discovery succeeds; when it fails the
 * first entry is used blind and a 429 or 404 falls through like any other
 * failure.
 */
const PREFERRED_REASONING = ["openai/gpt-5", "openai/o3", "openai/gpt-4.1"];
const PREFERRED_LONG_CODE = ["openai/gpt-4.1", "openai/gpt-5", "openai/gpt-4.1-mini"];

type Catalog = { ids: Set<string>; fetchedAt: number };
let catalogCache: Catalog | null = null;

/** What the last GitHub response said about the remaining budget. */
type RateHint = {
  remaining: number | null;
  /** Epoch ms when the window resets, from `x-ratelimit-reset` if present. */
  resetAt: number | null;
  /** Set on a 429. Until this passes, Lane 3 is skipped without a round trip. */
  blockedUntil: number | null;
};

const hint: RateHint = { remaining: null, resetAt: null, blockedUntil: null };

/** Default backoff when a 429 arrives without a usable `retry-after`. */
const DEFAULT_BACKOFF_MS = 5 * 60 * 1_000;

function recordRateHeaders(response: Response): void {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(remaining)) hint.remaining = remaining;

  /* `x-ratelimit-reset` is documented as seconds-until-reset on this API, but
     an absolute epoch is common elsewhere. Treat a large value as epoch so a
     format change degrades to a slightly stale hint rather than a permanent
     block. */
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    hint.resetAt = reset > 1_000_000_000 ? reset * 1_000 : Date.now() + reset * 1_000;
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    hint.blockedUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1_000
      : DEFAULT_BACKOFF_MS);
    hint.remaining = 0;
    return;
  }

  // A successful call proves the block is over, whatever the hint believed.
  if (response.ok && hint.blockedUntil && Date.now() >= hint.blockedUntil) hint.blockedUntil = null;
}

/**
 * Whether Lane 3 is worth attempting.
 *
 * Advisory only. Answering `false` skips a round trip that would have 429'd;
 * answering `true` is never a promise, and the caller must still handle the
 * failure by falling through silently.
 */
export function githubModelsAvailable(token: string | undefined): boolean {
  if (!token) return false;
  if (hint.blockedUntil && Date.now() < hint.blockedUntil) return false;
  /* Keep one in reserve. Spending the last request of a window on a routine
     turn means the next genuinely hard one has nowhere to go. */
  if (hint.remaining !== null && hint.remaining <= 1) {
    if (hint.resetAt && Date.now() >= hint.resetAt) {
      hint.remaining = null;
      return true;
    }
    return false;
  }
  return true;
}

/** For diagnostics surfaces. Never shown in a chat. */
export function githubModelsBudget(): RateHint {
  return { ...hint };
}

async function loadCatalog(token: string): Promise<Set<string> | null> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) return catalogCache.ids;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(CATALOG_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "NaviOS-Hub",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) return null;
    const payload = await response.json() as Array<{ id?: string; name?: string }>;
    const ids = new Set(
      (Array.isArray(payload) ? payload : [])
        .map((entry) => entry.id ?? entry.name)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    );
    if (!ids.size) return null;
    catalogCache = { ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    // Discovery is an optimisation; failing it must not fail the lane.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick a model that the account is actually offered.
 *
 * The handoff's model list could not be verified against GitHub's docs from
 * the build environment, so it is a preference order checked against the live
 * catalog rather than a hardcoded assumption. A renamed or retired id costs one
 * position in the list instead of an outage.
 */
export async function selectGithubModel(options: {
  token: string;
  capability: "reasoning" | "long-code";
}): Promise<string> {
  const preferred = options.capability === "long-code" ? PREFERRED_LONG_CODE : PREFERRED_REASONING;
  const catalog = await loadCatalog(options.token);
  if (!catalog) return preferred[0];
  return preferred.find((id) => catalog.has(id)) ?? preferred[0];
}

export function githubModelsRoute(model: string, capability: ProviderRoute["capability"]): ProviderRoute {
  return { provider: "githubmodels", model, label: "NaviSol · deep", capability };
}

/**
 * The provider, with a fetch wrapper that reads the rate-limit headers off
 * every response. The AI SDK gives no other hook for this, and the headers are
 * the whole budget mechanism — counting locally would be wrong across devices.
 */
export function createGithubModelsProvider(token: string, origin: string) {
  return createOpenAICompatible({
    name: "githubmodels",
    apiKey: token,
    baseURL: GITHUB_MODELS_BASE_URL,
    includeUsage: true,
    headers: { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "NaviOS-Hub", "HTTP-Referer": origin },
    fetch: async (input, init) => {
      const response = await fetch(input as RequestInfo, init as RequestInit);
      recordRateHeaders(response);
      return response;
    }
  });
}
