import { generateText, type ModelMessage } from "ai";
import { createProviderModel, ROUTES, type ProviderAvailability } from "./providers";

/**
 * Fit a long conversation into a small context window.
 *
 * Lane 3 caps around 8K input, so a conversation past a dozen turns cannot be
 * handed to it raw. Rather than route away from the best engine whenever a chat
 * gets long — which is exactly when the good engine is most wanted — the older
 * turns are summarised and the recent ones kept verbatim.
 *
 * Recency is kept whole on purpose. A summary is lossy, and the turns most
 * likely to matter are the ones just said; compressing those to save tokens
 * trades away the part of the context that was actually load-bearing.
 *
 * The summary is produced by a Lane 1 route. Spending a rationed Lane 3 call on
 * preparing another Lane 3 call would defeat the point.
 */

/** Roughly four characters to a token — close enough to budget against. */
const CHARS_PER_TOKEN = 4;
/** Recent turns always survive intact, however long the conversation is. */
const VERBATIM_TURNS = 6;
/** A summary longer than this is not a summary. */
const MAX_SUMMARY_TOKENS = 700;
const SUMMARY_BUDGET_MS = 9_000;

export function estimateTokens(messages: ModelMessage[]): number {
  let characters = 0;
  for (const message of messages) {
    characters += typeof message.content === "string"
      ? message.content.length
      // Multi-part content: only the text parts carry a meaningful length.
      : JSON.stringify(message.content).length;
  }
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

const SUMMARY_SYSTEM = `You are compressing the earlier part of a conversation so it can be carried forward in a smaller context window.

Preserve, in this order of priority:
1. Every constraint, requirement, preference, and decision the user stated. These must survive verbatim in meaning — losing one causes the assistant to violate it later.
2. Facts established about the user's situation, code, or data.
3. What has already been tried, and what the outcome was.
4. Anything explicitly left open or deferred.

Drop pleasantries, restatements, and reasoning that led to a conclusion already captured. Write compact prose or a bulleted ledger, not a transcript. Never invent detail that is not there, and never resolve something the conversation left open.`;

/**
 * Compact a conversation to fit a token budget.
 *
 * Returns the messages unchanged when they already fit, or when summarising
 * fails — a failed compaction must not fail the request, it just means this
 * conversation goes to a lane with more room.
 */
export async function compactForBudget(options: {
  messages: ModelMessage[];
  maxInputTokens: number;
  availability: ProviderAvailability;
  origin: string;
  abortSignal?: AbortSignal;
}): Promise<{ messages: ModelMessage[]; compacted: boolean }> {
  const { messages, maxInputTokens, availability, origin } = options;
  if (estimateTokens(messages) <= maxInputTokens) return { messages, compacted: false };
  if (messages.length <= VERBATIM_TURNS + 1) return { messages, compacted: false };

  const cutoff = messages.length - VERBATIM_TURNS;
  const older = messages.slice(0, cutoff);
  const recent = messages.slice(cutoff);

  /* Fast and cheap by design: this call exists to save a rationed one. */
  const route = availability.groq ? ROUTES.groqFast
    : availability.cerebras ? ROUTES.cerebrasFast
      : availability.gemini ? ROUTES.geminiSynthesis
        : null;
  if (!route) return { messages, compacted: false };

  try {
    const result = await generateText({
      model: createProviderModel(route, origin),
      system: SUMMARY_SYSTEM,
      prompt: older
        .map((message) => `${message.role}: ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`)
        .join("\n\n")
        .slice(0, 60_000),
      maxOutputTokens: MAX_SUMMARY_TOKENS,
      maxRetries: 0,
      timeout: { totalMs: SUMMARY_BUDGET_MS },
      abortSignal: options.abortSignal
    });

    const summary = result.text?.trim();
    if (!summary) return { messages, compacted: false };

    const compactedMessages: ModelMessage[] = [
      /* Marked as earlier context rather than presented as a turn, so the model
         does not answer the summary as though it were the live question. */
      { role: "system", content: `Summary of the earlier part of this conversation:\n\n${summary}` },
      ...recent
    ];

    /* If the summary did not actually help, the original is the safer input —
       a truncated conversation is worse than a longer one on a bigger lane. */
    if (estimateTokens(compactedMessages) > maxInputTokens) return { messages, compacted: false };
    return { messages: compactedMessages, compacted: true };
  } catch {
    return { messages, compacted: false };
  }
}
