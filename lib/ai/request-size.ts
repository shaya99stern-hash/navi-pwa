import type { ModelMessage } from "ai";
import type { ToolSet } from "ai";

/**
 * What a turn actually costs, measured rather than assumed.
 *
 * A production request was refused by Groq with `Request too large ... Limit
 * 8000, Requested 20805` — the turn was 2.6x the provider's entire per-minute
 * budget. Nothing in the app could say where those 20,805 tokens came from,
 * and the compaction that exists to prevent exactly this never fired, because
 * it measured only the message history. The message history was the small part.
 *
 * Measured on this codebase, for one ordinary turn with tools available:
 *
 * | contributor                              | tokens |
 * |------------------------------------------|--------|
 * | system prompt, base only                 |    965 |
 * | + APP_KNOWLEDGE                          |  2,159 |
 * | + CODE_CRAFT                             |  2,837 |
 * | + ENGINEERING_DISCIPLINE                 |  1,993 |
 * | + ORCHESTRATION_KNOWLEDGE                |    978 |
 * | + NAVI_MISSION                           |    841 |
 * | tool descriptions, 22 tools              |  1,409 |
 * | reserved for output (`maxOutputTokens`)  |  8,000 |
 *
 * Roughly 19,000 tokens before the user has typed anything. The optional prompt
 * blocks all load together on the turns that matter most — asking about the app,
 * while holding the commit tools — so the worst case is the common case.
 *
 * The lesson this module encodes: a budget that measures one contributor is not
 * a budget. Every part of the payload is counted here, including the output
 * reservation, because providers that ration by throughput count that too.
 */

/**
 * Roughly four characters to a token.
 *
 * The same ratio `compaction.ts` and the prompt budget already use, kept
 * deliberately identical: two estimators that disagree produce a budget that
 * one part of the system believes and another does not. It reads slightly high
 * for English prose and slightly low for JSON, which is the right direction for
 * a ceiling — over-estimating costs a shorter prompt, under-estimating costs
 * the request.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: ModelMessage[]): number {
  let characters = 0;
  for (const message of messages) {
    characters += typeof message.content === "string"
      ? message.content.length
      : JSON.stringify(message.content).length;
  }
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

/**
 * What a toolset costs on the wire.
 *
 * Name and description are the parts this app controls and the parts that
 * dominate; the JSON schema for the parameters adds to them. `SCHEMA_OVERHEAD`
 * is a multiplier rather than a real serialisation because the provider's own
 * conversion is what ships, and a measurement of our approximation of it would
 * be a measurement of the approximation.
 *
 * Erring high is deliberate. This number is subtracted from a budget, so an
 * over-estimate leaves headroom and an under-estimate is a rejected request.
 */
const SCHEMA_OVERHEAD = 1.6;

export function estimateToolTokens(tools: ToolSet): number {
  let characters = 0;
  for (const [name, definition] of Object.entries(tools)) {
    characters += name.length + String((definition as { description?: string })?.description ?? "").length;
  }
  return Math.ceil((characters / CHARS_PER_TOKEN) * SCHEMA_OVERHEAD);
}

export type RequestSize = {
  system: number;
  tools: number;
  messages: number;
  /** Reserved for the reply. Counted because throughput limits count it. */
  output: number;
  /** Everything the provider will bill against its ceiling for this request. */
  total: number;
};

export function measureRequest(parts: {
  system: string;
  tools: ToolSet;
  messages: ModelMessage[];
  output: number;
}): RequestSize {
  const system = estimateTextTokens(parts.system);
  const tools = estimateToolTokens(parts.tools);
  const messages = estimateMessageTokens(parts.messages);
  return { system, tools, messages, output: parts.output, total: system + tools + messages + parts.output };
}

/**
 * The breakdown as one log line, largest contributor named.
 *
 * Written for the person reading Vercel's runtime logs at the moment a request
 * was refused for size. A total alone tells them it was too big, which they
 * already know from the provider's error; the point of this line is to say
 * which part to go and shrink.
 */
export function describeRequestSize(size: RequestSize, ceiling: number): string {
  const contributors: Array<[string, number]> = [
    ["system", size.system],
    ["tools", size.tools],
    ["messages", size.messages],
    ["output reserve", size.output]
  ];
  const largest = contributors.reduce((a, b) => (b[1] > a[1] ? b : a));
  const parts = contributors.map(([name, tokens]) => `${name} ${tokens}`).join(", ");
  return `${size.total} tokens against a ${ceiling} ceiling (${parts}); largest is ${largest[0]}.`;
}
