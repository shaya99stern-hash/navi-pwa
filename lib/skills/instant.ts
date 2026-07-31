"use client";

import { evaluateExpression } from "./impl/math";
import * as math from "./impl/math";
import * as datetime from "./impl/datetime";
import type { SkillResult } from "./registry";

/**
 * Answers a narrow class of question on the device, before any request goes
 * out: pure arithmetic, unit conversion, and "what is today".
 *
 * These are questions with exactly one right answer that a function already
 * knows. Sending them to a model costs a round trip, needs a network, and
 * introduces the possibility of a wrong answer to a question that cannot have
 * one. Anything outside these shapes returns null and goes to the model, which
 * is the safe default — a false match here would intercept a real question.
 */
export type InstantAnswer = { text: string; skill: string };

/** Deliberately strict: digits and operators only, nothing resembling prose. */
const ARITHMETIC = /^[\s\d+\-*/^%().,]+$/;
const HAS_OPERATOR = /[+\-*/^%]/;

const CONVERSION = new RegExp(
  String.raw`^(?:how (?:many|much) is\s+|what(?:'s| is)\s+|convert\s+)?` +
  String.raw`(-?\d+(?:\.\d+)?)\s*` +
  String.raw`([a-z°]{1,6})\s+(?:in|to|as)\s+([a-z°]{1,6})\s*\??$`,
  "i"
);

const TODAY = /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:today'?s?\s+date|date today|what day is it(?:\s+today)?)\s*\??$/i;

function unwrap(result: SkillResult): string | null {
  if (!result.ok) return null;
  return typeof result.output === "string" ? result.output : null;
}

export async function instantAnswer(input: string): Promise<InstantAnswer | null> {
  const query = input.trim();
  if (!query || query.length > 120 || query.startsWith("/")) return null;

  // Bare arithmetic: "1240 * 0.17", "(3+4)/2".
  const bare = query.replace(/[?=\s]+$/, "");
  if (ARITHMETIC.test(bare) && HAS_OPERATOR.test(bare) && /\d/.test(bare)) {
    try {
      const value = evaluateExpression(bare.replace(/,/g, ""));
      return { text: `${bare} = ${value}`, skill: "math.expression-evaluate" };
    } catch {
      return null; // Malformed; let the model read it as prose instead.
    }
  }

  const conversion = CONVERSION.exec(query);
  if (conversion) {
    const [, value, from, to] = conversion;
    const text = unwrap(await math.unitConvert({
      value: Number(value),
      from: from.replace("°", ""),
      to: to.replace("°", "")
    }));
    if (text) return { text, skill: "math.unit-convert" };
    return null; // Not a unit pair we know; the model may still answer it.
  }

  if (TODAY.test(query)) {
    const result = await datetime.dateFormat({ value: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (result.ok && result.output && typeof result.output === "object") {
      const formatted = result.output as { full?: string };
      if (formatted.full) return { text: formatted.full, skill: "datetime.date-format" };
    }
    return null;
  }

  return null;
}
