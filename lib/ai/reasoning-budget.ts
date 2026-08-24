import type { ProviderRoute } from "./types";

/**
 * How much of a reply's budget may be spent thinking before it starts writing.
 *
 * Reasoning models emit their deliberation as output tokens, counted against
 * the same `max_tokens` as the answer. On a free tier that is not a footnote:
 * Groq's window is 8,000 tokens for input *plus* reserved output, so a turn
 * carrying the system prompt, the artifact contract and a few tool schemas has
 * roughly two to three thousand left. A model at default reasoning effort can
 * spend most of that deciding what to write.
 *
 * The observed failure, and the reason this file exists: asked for an
 * interactive kitchen mood board, the model reasoned at length, emitted
 *
 *     {"id":"kitchen-moodboard","title":"Kitchen Mood Board","kind":"html","height":500}
 *
 * and stopped. A complete, correct artifact header with no document under it.
 * Nothing was wrong with the request, the contract, or the model's
 * understanding of either — it had thought until there was no room left to
 * answer.
 *
 * This makes that trade explicit rather than leaving it to a default that
 * knows nothing about the budget it is spending.
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Below this, deliberation is competing with the answer for room rather than
 * improving it. Chosen against what the app actually asks for: a short reply
 * fits in a few hundred tokens, and an artifact does not fit in 2,500 at all
 * if a third of them went on thinking.
 */
export const TIGHT_OUTPUT_TOKENS = 3_000;

/**
 * Whether this route's model reads `reasoning_effort` at all.
 *
 * Deliberately a allowlist rather than "send it and hope". Most
 * OpenAI-compatible endpoints ignore an unknown body field, but not all do,
 * and a 400 from a field we added would be a self-inflicted outage on the
 * provider the app leads with.
 */
export function acceptsReasoningEffort(route: ProviderRoute): boolean {
  return route.provider === "groq" && /gpt-oss/i.test(route.model);
}

/**
 * The effort to request, or null to leave the provider's default alone.
 *
 * Artifacts are the case this exists for: they are the most output-heavy thing
 * the app produces, and the one where thinking budget converts directly into a
 * document that does not arrive.
 */
export function reasoningEffortFor(options: {
  route: ProviderRoute;
  outputTokens: number;
  artifactRequested: boolean;
  /** The user's own dial. High effort is a request for more thought, and is honoured. */
  effort: "low" | "medium" | "high";
}): ReasoningEffort | null {
  const { route, outputTokens, artifactRequested, effort } = options;
  if (!acceptsReasoningEffort(route)) return null;

  /* An explicit High is the user asking for the thorough answer, and it is
     theirs to spend. The budget still binds — it simply is not this function's
     place to overrule the dial. */
  if (effort === "high") return "high";

  /* A whole styled, scripted document has to come out of what remains. */
  if (artifactRequested) return "low";
  if (outputTokens < TIGHT_OUTPUT_TOKENS) return "low";
  return effort === "low" ? "low" : "medium";
}

/**
 * The `providerOptions` argument for a turn, keyed by the provider name the
 * model was created under — which is what `@ai-sdk/openai-compatible` spreads
 * into the request body.
 */
export function reasoningProviderOptions(options: {
  route: ProviderRoute;
  outputTokens: number;
  artifactRequested: boolean;
  effort: "low" | "medium" | "high";
}): Record<string, Record<string, string>> | undefined {
  const level = reasoningEffortFor(options);
  if (!level) return undefined;
  return { [options.route.provider]: { reasoning_effort: level } };
}
