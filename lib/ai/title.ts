import { generateText } from "ai";
import { createProviderModel, ROUTES, type ProviderAvailability } from "./providers";

/**
 * A title that says what the conversation was about.
 *
 * The heuristic in `chatTitle` strips lead-ins off the first sentence and takes
 * seven words, which is a good deal better than echoing the prompt and still
 * produces "Write me a function that takes" for a thread about parsing dates.
 * The history drawer is a list of these, and a list of truncated openings is
 * hard to scan precisely when it matters — when there are enough chats that you
 * need the list at all.
 *
 * Free by construction. This runs on a Lane 1 route, which is the same free
 * fast tier the compaction summariser uses, with a cap of a few dozen tokens
 * and a short deadline. Spending a paid route on a chat title would be an
 * absurd trade, and spending a slow one would mean the title arrives after the
 * user has moved on.
 *
 * Every failure path returns null, and the caller keeps the heuristic. A title
 * is a convenience: it must never be able to fail a conversation, delay one, or
 * cost anything.
 */

/** Long enough for a real phrase, short enough for the drawer's one line. */
const MAX_TITLE_TOKENS = 24;
const TITLE_BUDGET_MS = 6_000;
/** Beyond this a title is not a title, whatever the model returned. */
const MAX_TITLE_CHARS = 48;

const TITLE_SYSTEM = `You write short titles for saved conversations.

Return the title and nothing else: no quotes, no trailing punctuation, no "Title:" prefix, no explanation.

Three to six words. Name the specific subject, not the shape of the request — "Parsing ISO dates in Safari", never "Coding help" or "User asks about dates". Sentence case. If the conversation is too short to have a subject, return the single most concrete noun phrase in it.`;

/**
 * Tidy whatever came back into something that can go straight into a list.
 *
 * Models comply with "no quotes, no prefix" most of the time, and a title is
 * displayed rather than parsed, so the one that slips through is seen by the
 * user rather than caught by anything. Cheaper to strip than to re-prompt.
 */
export function tidyTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const unlabelled = collapsed.replace(/^(?:title|chat|conversation)\s*[:—-]\s*/i, "");
  const unquoted = unlabelled.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  const trimmed = unquoted.replace(/[.,;:\s]+$/, "").trim();
  /* A model that ignored the instruction and wrote a sentence produces
     something worse than the heuristic, so it is refused rather than cut: a
     truncated sentence reads as a bug, while the heuristic reads as a title. */
  if (!trimmed || trimmed.length > MAX_TITLE_CHARS) return null;
  if (trimmed.split(" ").length > 8) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export async function summariseTitle(options: {
  question: string;
  answer: string;
  availability: ProviderAvailability;
  origin: string;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const { question, answer, availability, origin, abortSignal } = options;
  if (!question.trim()) return null;

  /* Fast and free, in that order of preference. Identical to the compaction
     summariser's choice, and for the same reason: this call exists to improve
     something small and must never become the expensive part of a turn. */
  const route = availability.groq ? ROUTES.groqFast
    : availability.cerebras ? ROUTES.cerebrasFast
      : availability.gemini ? ROUTES.geminiSynthesis
        : null;
  if (!route) return null;

  try {
    const result = await generateText({
      model: createProviderModel(route, origin),
      system: TITLE_SYSTEM,
      /* The reply is included because the question alone is often ambiguous
         about what the thread turned out to be about — "why doesn't this work"
         titles nothing without it. Both are clipped hard: a title needs the
         subject, not the transcript, and this route is on a small free tier. */
      prompt: `Question:\n${question.slice(0, 1_500)}\n\nAnswer:\n${answer.slice(0, 1_500)}`,
      maxOutputTokens: MAX_TITLE_TOKENS,
      maxRetries: 0,
      timeout: { totalMs: TITLE_BUDGET_MS },
      abortSignal
    });
    return tidyTitle(result.text ?? "");
  } catch {
    return null;
  }
}
