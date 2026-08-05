import "server-only";

import { generateText } from "ai";

import { createProviderModel, ROUTES, type ProviderAvailability } from "../ai/providers";

/**
 * Noticing that something said is worth remembering.
 *
 * Two stages, because the expensive one must almost never run. A regex decides
 * whether a message could plausibly contain a durable fact; only then does a
 * model read it. Sending every turn to a model to be told "nothing here" would
 * cost a call per message for a feature that fires on perhaps one in fifty.
 *
 * The bar for remembering is deliberately high. A memory that fills with
 * "wants a bash script" is worse than no memory: it spends context on noise
 * every turn and makes the assistant confidently wrong about who it is talking
 * to. What earns a row is a standing fact about the person — how they work,
 * what they use, what they always want — not the topic of one request.
 */

/**
 * Only these shapes are even considered.
 *
 * The first version of this list was too narrow in a way that only a real user
 * found: "I like honesty can you save to memory" matched nothing, because
 * `like` was not among the preference verbs and `save to memory` was not among
 * the instructions. Someone asking in as many words to have something
 * remembered was turned away before a model ever read it — the clearest signal
 * available, missed.
 *
 * Strict is still right for the *implicit* shapes: a false positive there costs
 * a call and possibly a junk row. But an explicit request is not a guess about
 * intent, it is the intent, and it always passes.
 */
const DURABLE_SHAPES = [
  // An explicit request. Never turned away — this is someone telling us.
  /\b(remember|memori[sz]e|keep in mind|bear in mind|for future reference|from now on|going forward|don'?t forget)\b/i,
  /\b(save|add|commit|write|put)\b[^.!?]{0,24}\b(to|in|into)\s+(your\s+)?memory\b/i,
  /\bnote\s+(that|this|down)\b/i,
  // Stated identity, situation, or possession.
  /\bI(?:'m| am)\s+(?:a|an|the)?\s*\w+/i,
  /\bmy\s+(?:name|team|company|job|role|stack|setup|timezone|time zone|project|repo|editor|language)\b/i,
  // Stated preference or habit.
  /\bI\s+(?:use|prefer|like|love|hate|value|avoid|always|never|usually|generally|tend to|care about|stick to|work with|work in|write in|code in|live in|speak)\b/i,
  /\bI\s+(?:don'?t|do not|can'?t|cannot)\s+\w+/i,
  // Stated constraint that outlives the request.
  /\bI\s+(?:need|want)\s+(?:you\s+to\s+)?(?:always|never)\b/i
];

/** Below this there is nothing to extract from. */
const MIN_LENGTH = 12;
const MAX_LENGTH = 2_000;
const MAX_FACTS_PER_TURN = 3;
const EXTRACT_BUDGET_MS = 6_000;
const MAX_OUTPUT_TOKENS = 200;

/**
 * Could this message contain a standing fact?
 *
 * Deliberately the opposite bias to `needsAppKnowledge`: there, a false
 * negative costs a wrong answer, so it is generous. Here a false positive costs
 * a model call and possibly a junk row that then pollutes every later turn, so
 * it is strict. Missing a fact is cheap — the person will say it again.
 */
export function looksDurable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return false;
  return DURABLE_SHAPES.some((shape) => shape.test(trimmed));
}

const SYSTEM = `You decide whether a message contains a durable fact about the person writing it — something still true next week, in a different conversation, about a different subject.

Return ONLY a JSON array of strings. Return [] far more often than not.

Record:
- Stable attributes: role, team, location, time zone, languages they work in.
- Standing preferences: tools they use, conventions they follow, how they want answers.
- Explicit instructions to remember something.

Never record:
- What they are asking about right now, or any detail of the current task.
- Anything about a specific file, error, repository, or piece of code.
- Opinions expressed in passing, or anything hedged with "maybe" or "for now".
- Anything a reasonable person would be unsettled to find stored.

Write each fact as one short third-person statement, self-contained, no pronouns referring outside itself. "Works in TypeScript", not "they said they use it".

Examples:
"I always want answers in metric" -> ["Wants answers in metric"]
"I'm a nurse in Toronto" -> ["Works as a nurse", "Based in Toronto"]
"can you fix this null check" -> []
"I need this by Friday" -> []`;

/**
 * Pull durable facts out of one message. Empty on any failure.
 *
 * Uses a Lane 1 route: this exists to be cheap, and spending a good model on
 * deciding what to remember would cost more than the memory is worth.
 */
export async function extractFacts(options: {
  text: string;
  availability: ProviderAvailability;
  origin: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { text, availability, origin } = options;
  if (!looksDurable(text)) return [];

  const route = availability.groq ? ROUTES.groqFast
    : availability.cerebras ? ROUTES.cerebrasFast
      : availability.gemini ? ROUTES.geminiSynthesis
        : null;
  if (!route) return [];

  try {
    const result = await generateText({
      model: createProviderModel(route, origin),
      system: SYSTEM,
      prompt: text.slice(0, MAX_LENGTH),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      timeout: { totalMs: EXTRACT_BUDGET_MS },
      abortSignal: options.signal
    });
    return parseFacts(result.text ?? "");
  } catch {
    /* Remembering is never worth failing a turn over. The answer has already
       been delivered by the time this runs. */
    return [];
  }
}

/**
 * Read the model's reply as a list of facts.
 *
 * Exported for its own test: a model that wraps JSON in prose or a fence is the
 * normal case, not the exception, and "no facts" and "unparseable" must both
 * come out as an empty list rather than one becoming a stored row.
 */
export function parseFacts(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      /* A "fact" of two words is noise, and one of several sentences is a
         summary of the conversation rather than a fact about the person. */
      .filter((item) => item.length >= 8 && item.length <= 200)
      .slice(0, MAX_FACTS_PER_TURN);
  } catch {
    return [];
  }
}
