/* PATH: lib/ai/navi-soul/provider-ceilings.ts  — NEW FILE, copy verbatim. */

import { numberEnvironment } from "../catalog";
import type { ProviderName } from "../types";

/**
 * What each provider will accept for one request, in tokens, including the
 * output reservation — because providers that ration by throughput count it.
 *
 * This table exists because of a production refusal: Groq answered a turn with
 * `Request too large ... Limit 8000, Requested 20805`. The app could measure a
 * request (`request-size.ts`) but had no number to measure it *against*, so the
 * measurement never prevented anything. A budget with no ceiling is a log line.
 *
 * Defaults are deliberately conservative: an over-estimate here costs a
 * shorter prompt or a rerouted request, an under-estimate costs the whole
 * request — the same direction-of-error rule `request-size.ts` states. The
 * Groq figure is the one that is *known* (it is quoted from the provider's own
 * refusal); the rest are floors an operator can raise per deployment with
 * `NAVI_TOKEN_CEILING_<PROVIDER>` once they have seen their tier's real limits.
 */
const DEFAULT_CEILINGS: Partial<Record<ProviderName, number>> = {
  groq: 8_000,
  gemini: 120_000,
  huggingface: 28_000,
  openrouter: 60_000,
  cerebras: 24_000,
  mistral: 28_000,
  deepseek: 56_000,
  together: 16_000,
  nvidia: 16_000,
  sambanova: 16_000
};

/** A provider the table has never heard of gets the cautious middle. */
const FALLBACK_CEILING = 16_000;

export function providerCeiling(provider: ProviderName): number {
  const name = `NAVI_TOKEN_CEILING_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return numberEnvironment(name, DEFAULT_CEILINGS[provider] ?? FALLBACK_CEILING, 4_000, 1_000_000);
}

/**
 * The configured provider with the most headroom, for "this cannot shrink
 * enough" reroutes. Exposed as data rather than a route so the preflight can
 * combine it with what is actually available this turn.
 */
export function largestCeiling(providers: ProviderName[]): ProviderName | null {
  let best: ProviderName | null = null;
  for (const provider of providers) {
    if (!best || providerCeiling(provider) > providerCeiling(best)) best = provider;
  }
  return best;
}
