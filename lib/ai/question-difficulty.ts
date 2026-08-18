/**
 * How hard a question is, decided from the question rather than its length.
 *
 * Lifted out of the chat route so it can be tested directly. It decides which
 * lane a turn takes, which decides which model answers it — the single largest
 * influence on how the app reads — and until now no test could reach it, since
 * the route imports `server-only`.
 */

export type Effort = "normal" | "complex" | "extreme";

/**
 * Questions that want judgement rather than recall.
 *
 * Length was doing almost all the work here, and length is a property of how
 * someone typed, not of what they asked. "Which of these two contracts should I
 * sign?" is nine words and needs every bit of reasoning available; a pasted
 * error log is six hundred characters of nothing hard.
 *
 * The bias fell hardest on speech, where it was close to total: spoken turns
 * are short by nature, so a voice conversation could not reach the reasoning
 * lane at all. Every answer the owner has heard aloud came from the fast lane —
 * which is a complete explanation for an app that reads as "way too low
 * intelligence" when talked to and better when typed at.
 *
 * These are the shapes of a question that has no lookup answer: a comparison, a
 * recommendation, a trade-off, a plan, a cause. Deliberately generous, because
 * the cost of being wrong is asymmetric — a simple question sent to a stronger
 * model is a second of latency, and a hard question sent to a fast one is a
 * shallow answer the person has to notice is shallow.
 */
export const NEEDS_JUDGEMENT = /\b(why|how (?:should|do|would|can|might)|what(?:'s| is) the best|which (?:one|of|is better)|should (?:i|we|it)|compare|versus|vs\.?|trade[- ]?offs?|pros and cons|worth it|recommend|suggest|advise|decide|choose|plan (?:for|out)|strategy|approach|figure out|work out|explain|walk me through|help me (?:with|think)|what if|instead of|better (?:way|than|option))\b/i;

export function complexity(text: string): Effort {
  const extreme = text.length > 1_800 || /\b(exhaustive|deep audit|production-ready|entire codebase|long-horizon|multi-agent|research report|principal architect)\b/i.test(text);
  if (extreme) return "extreme";
  const complex = text.length > 650
    || NEEDS_JUDGEMENT.test(text)
    || /\b(architecture|audit|analy[sz]e|debug|proof|strategy|compare|research|legal|financial|medical|typescript|javascript|react|next\.?js|python|sql|multi-step|comprehensive)\b/i.test(text);
  return complex ? "complex" : "normal";
}
