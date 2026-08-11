"use client";

import { evaluateExpression } from "./impl/math";
import * as math from "./impl/math";
import * as datetime from "./impl/datetime";
import * as crypto from "./impl/crypto";
import * as encode from "./impl/encode";
import * as text from "./impl/text";
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

/**
 * Render a skill result for a one-line answer, including structured output.
 *
 * `unwrap` accepts only strings, which silently dropped every skill that
 * returns an object — word counts, percentages, base conversions all matched
 * their pattern, ran correctly, and then produced nothing. A route that fires
 * and returns null is worse than one that never fires: the work is done and
 * thrown away.
 *
 * Objects render as a compact `key: value` line rather than fenced JSON,
 * because this path exists to answer in one line. Anything deeper than one
 * level is left to the model, which will present it better than a flattener.
 */
function render(result: SkillResult): string | null {
  if (!result.ok) return null;
  const { output } = result;
  if (typeof output === "string") return output || null;
  if (typeof output === "number" || typeof output === "boolean") return String(output);
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const pairs = Object.entries(output as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
      .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${value}`);
    return pairs.length ? pairs.join(" · ") : null;
  }
  if (Array.isArray(output)) return output.length ? output.map(String).join(", ") : null;
  return null;
}


/**
 * Prose shapes that map onto a deterministic skill.
 *
 * Ordered most specific first; the first match wins. Keep them anchored — an
 * unanchored pattern will eventually swallow a question that only mentions the
 * word.
 */
const PROSE_ROUTES: Array<{
  pattern: RegExp;
  skill: string;
  run: (match: RegExpExecArray) => Promise<SkillResult>;
}> = [
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?(sha-?(?:1|256|384|512))\s+(?:hash\s+)?(?:of|for)\s+(.+?)\s*\??$/i,
    skill: "crypto.sha-hash",
    run: (m) => crypto.shaHash({ text: m[2], algorithm: m[1].replace(/^sha-?/i, "SHA-") })
  },
  {
    pattern: /^base\s?64\s+(encode|decode)\s+(.+)$/i,
    skill: "encode.base64-encode-decode",
    run: (m) => encode.base64({ text: m[2], decode: m[1].toLowerCase() === "decode" })
  },
  {
    pattern: /^url\s+(encode|decode)\s+(.+)$/i,
    skill: "encode.url-encode-decode",
    run: (m) => encode.urlEncode({ text: m[2], decode: m[1].toLowerCase() === "decode" })
  },
  {
    pattern: /^hex\s+(encode|decode)\s+(.+)$/i,
    skill: "encode.hex-convert",
    run: (m) => encode.hexConvert({ text: m[2], decode: m[1].toLowerCase() === "decode" })
  },
  {
    pattern: /^rot-?13\s+(.+)$/i,
    skill: "encode.rot13-caesar",
    run: (m) => encode.rot13({ text: m[1] })
  },
  {
    /* "a uuid", "3 uuids", "generate a uuid" — all the same request. */
    pattern: /^(?:generate|make|give me|create)?\s*(?:an?\s+|(\d{1,2})\s+)?uuids?\s*\??$/i,
    skill: "crypto.uuid-generate",
    run: (m) => crypto.uuidGenerate({ count: m[1] ? Number(m[1]) : 1 })
  },
  {
    pattern: /^(?:generate|make|give me|create)\s+(?:a\s+)?(?:random\s+)?password(?:\s+(?:of\s+)?(\d{1,3})\s*(?:chars?|characters?)?)?\s*\??$/i,
    skill: "crypto.password-generate",
    run: (m) => crypto.passwordGenerate({ length: m[1] ? Number(m[1]) : 20 })
  },
  {
    pattern: /^(?:how many words (?:are )?(?:in|does)|word count (?:of|for))\s+(.+?)\s*\??$/i,
    skill: "text.word-char-count",
    run: (m) => text.wordCharCount({ text: m[1] })
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)\s*\??$/i,
    skill: "math.percentage",
    /* `a` and `b`, in mode "of" — the executor names them positionally. */
    run: (m) => math.percentage({ mode: "of", a: Number(m[1]), b: Number(m[2]) })
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(\d{1,4})\s+in\s+roman(?:\s+numerals?)?\s*\??$/i,
    skill: "math.roman-numerals",
    run: (m) => math.romanNumerals({ value: Number(m[1]) })
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(-?\d+)\s+in\s+(binary|hex(?:adecimal)?|octal)\s*\??$/i,
    skill: "math.base-convert",
    run: (m) => math.baseConvert({
      value: m[1],
      from: 10,
      to: /^bin/i.test(m[2]) ? 2 : /^oct/i.test(m[2]) ? 8 : 16
    })
  },
  {
    pattern: /^(?:how many days|days)\s+(?:are\s+)?between\s+(.+?)\s+and\s+(.+?)\s*\??$/i,
    skill: "datetime.date-difference",
    run: (m) => datetime.dateDifference({ from: m[1], to: m[2], unit: "days" })
  },
  {
    pattern: /^(?:generate|give me)?\s*(?:a\s+)?random number between\s+(-?\d+)\s+and\s+(-?\d+)\s*\??$/i,
    skill: "math.random-number",
    run: (m) => math.randomNumber({ min: Number(m[1]), max: Number(m[2]) })
  }
];

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

  /* Everything above stays as it was. What follows widens the doorway.

     Measured before writing any of it: all 82 on-device skills resolve with no
     provider call — and exactly three of them were reachable from ordinary
     prose. The other 79 worked perfectly and were invisible unless you already
     knew the slash command existed, which nobody does. So the library was
     never the bottleneck; the way in was. Adding more skills would not have
     removed a single model call.

     Each pattern is deliberately strict. A false match here intercepts a real
     question and answers it with a tool, which is far worse than missing one
     and letting the model handle it — so every one of these anchors both ends
     and requires its keyword, rather than merely looking for it somewhere in
     a sentence. */
  for (const route of PROSE_ROUTES) {
    const match = route.pattern.exec(query);
    if (!match) continue;
    const text = render(await route.run(match));
    if (text) return { text, skill: route.skill };
    /* A pattern that matched but produced nothing is not an error worth
       showing — it means the arguments were not what they looked like, and the
       model can still answer properly. */
    return null;
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
