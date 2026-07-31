import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

export const regexEscape: Executor = async (input) =>
  ok(str(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

function compile(input: Record<string, unknown>): RegExp {
  const pattern = String(input.pattern ?? "");
  if (!pattern) throw new Error("Provide a `pattern`.");
  let flags = String(input.flags ?? "g");
  if (!flags.includes("g")) flags += "g";
  return new RegExp(pattern, flags);
}

export const regexTest: Executor = async (input) => {
  try {
    const re = compile(input);
    const text = str(input);
    const matches = [...text.matchAll(re)];
    return ok({
      pattern: re.source,
      flags: re.flags,
      matchCount: matches.length,
      matches: matches.slice(0, 50).map((m) => ({
        match: m[0], index: m.index, groups: m.slice(1), named: m.groups ?? null
      }))
    }, "application/json");
  } catch (error) {
    return fail((error as Error).message);
  }
};

export const regexExtract: Executor = async (input) => {
  try {
    const re = compile(input);
    const group = Number(input.group) || 0;
    const matches = [...str(input).matchAll(re)].map((m) => m[group] ?? "");
    if (!matches.length) return ok("No matches.");
    return ok(matches.join("\n"));
  } catch (error) {
    return fail((error as Error).message);
  }
};

export const regexReplace: Executor = async (input) => {
  try {
    const re = compile(input);
    const text = str(input);
    const count = [...text.matchAll(re)].length;
    return ok(`${text.replace(re, String(input.replacement ?? ""))}\n\n— ${count} replacement(s)`);
  } catch (error) {
    return fail((error as Error).message);
  }
};

export const globToRegex: Executor = async (input) => {
  const glob = str(input, "glob") || str(input);
  if (!glob) return fail("Provide a glob pattern.");
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i += 1; if (glob[i + 1] === "/") i += 1; }
      else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else if (char === "{") out += "(";
    else if (char === "}") out += ")";
    else if (char === ",") out += "|";
    else out += char.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }
  return ok(`^${out}$`);
};

const COMMON: Record<string, string> = {
  email: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
  url: "https?://[^\\s/$.?#].[^\\s]*",
  ipv4: "\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\b",
  uuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
  hexColor: "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b",
  isoDate: "\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2})?)?",
  usPhone: "(?:\\+1[-. ]?)?\\(?\\d{3}\\)?[-. ]?\\d{3}[-. ]?\\d{4}",
  slug: "[a-z0-9]+(?:-[a-z0-9]+)*"
};

export const commonPatterns: Executor = async (input) => {
  const name = String(input.name ?? "").trim();
  if (!name) return ok(COMMON, "application/json");
  const pattern = COMMON[name];
  if (!pattern) return fail(`Unknown pattern. Available: ${Object.keys(COMMON).join(", ")}.`);
  const text = str(input);
  if (!text) return ok(pattern);
  const matches = [...text.matchAll(new RegExp(pattern, "g"))].map((m) => m[0]);
  return ok(matches.length ? matches.join("\n") : "No matches.");
};

const STOPWORDS = new Set(("a an and are as at be but by for from has have he her his i in is it its of on or "
  + "she that the their them there they this to was were will with you your our we us not no so if then than").split(" "));

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

export const readingTime: Executor = async (input) => {
  const wpm = Math.max(50, Number(input.wpm) || 220);
  const count = words(str(input)).length;
  const minutes = count / wpm;
  return ok({
    words: count,
    wordsPerMinute: wpm,
    minutes: Math.round(minutes * 10) / 10,
    display: minutes < 1 ? "under a minute" : `${Math.round(minutes)} min read`
  }, "application/json");
};

export const keywordFrequency: Executor = async (input) => {
  const all = words(str(input)).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (!all.length) return fail("No countable words found.");
  const counts = new Map<string, number>();
  for (const word of all) counts.set(word, (counts.get(word) ?? 0) + 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  return ok([...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count, percent: Math.round((count / all.length) * 1000) / 10 })), "application/json");
};

export const nGramExtract: Executor = async (input) => {
  const n = Math.min(5, Math.max(2, Number(input.n) || 2));
  const all = words(str(input));
  if (all.length < n) return fail(`Need at least ${n} words.`);
  const counts = new Map<string, number>();
  for (let i = 0; i <= all.length - n; i += 1) {
    const gram = all.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  return ok([...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([gram, count]) => ({ gram, count })), "application/json");
};

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export const levenshteinDistance: Executor = async (input) => {
  const a = str(input, "a");
  const b = str(input, "b");
  if (!a || !b) return fail("Provide two strings as `a` and `b`.");
  const distance = levenshtein(a, b);
  const similarity = 1 - distance / Math.max(a.length, b.length);
  return ok({ distance, similarity: Math.round(similarity * 1000) / 10 + "%" }, "application/json");
};

export const fuzzyMatch: Executor = async (input) => {
  const query = str(input, "query").toLowerCase();
  const candidates = Array.isArray(input.candidates)
    ? (input.candidates as unknown[]).map(String)
    : str(input).split("\n").filter((l) => l.trim());
  if (!query || !candidates.length) return fail("Provide a `query` and candidate lines.");
  return ok(candidates
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      const distance = levenshtein(query, lower);
      const contains = lower.includes(query);
      const score = (contains ? 0.5 : 0) + (1 - distance / Math.max(query.length, lower.length));
      return { candidate, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(50, Number(input.limit) || 10)), "application/json");
};

function syllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/(?:es|ed|[^aeiouy]e)$/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export const readabilityScore: Executor = async (input) => {
  const text = str(input);
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length || 1;
  const wordList = words(text);
  if (!wordList.length) return fail("No words to score.");
  const syllableTotal = wordList.reduce((sum, w) => sum + syllables(w), 0);
  const complex = wordList.filter((w) => syllables(w) >= 3).length;
  const wordsPerSentence = wordList.length / sentences;
  const syllablesPerWord = syllableTotal / wordList.length;
  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  const fog = 0.4 * (wordsPerSentence + 100 * (complex / wordList.length));
  const round = (v: number) => Math.round(v * 10) / 10;
  return ok({
    words: wordList.length, sentences, wordsPerSentence: round(wordsPerSentence),
    fleschReadingEase: round(flesch),
    fleschKincaidGrade: round(grade),
    gunningFog: round(fog),
    interpretation: flesch >= 70 ? "easy" : flesch >= 50 ? "fairly difficult" : flesch >= 30 ? "difficult" : "very difficult"
  }, "application/json");
};

export const outlineExtract: Executor = async (input) => {
  const headings = [...str(input).matchAll(/^(#{1,6})\s+(.+)$/gm)]
    .map((m) => ({ level: m[1].length, text: m[2].trim() }));
  if (!headings.length) return fail("No Markdown headings found.");
  return ok(headings.map((h) => `${"  ".repeat(h.level - 1)}${h.text}`).join("\n"));
};

export const tableOfContents: Executor = async (input) => {
  const headings = [...str(input).matchAll(/^(#{1,6})\s+(.+)$/gm)]
    .map((m) => ({ level: m[1].length, text: m[2].trim() }));
  if (!headings.length) return fail("No Markdown headings found.");
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ok(headings.map((h) => `${"  ".repeat(h.level - 1)}- [${h.text}](#${slug(h.text)})`).join("\n"));
};

export const todoExtract: Executor = async (input) => {
  const lines = str(input).split("\n");
  const found = lines.flatMap((line, index) => {
    const checkbox = /^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/.exec(line);
    if (checkbox) return [{ line: index + 1, done: checkbox[1].toLowerCase() === "x", text: checkbox[2].trim() }];
    const marker = /\b(TODO|FIXME|HACK|XXX|NOTE)\b:?\s*(.*)$/.exec(line);
    if (marker) return [{ line: index + 1, done: false, text: `${marker[1]}: ${marker[2].trim()}` }];
    return [];
  });
  if (!found.length) return fail("No checkboxes or TODO markers found.");
  return ok(found, "application/json");
};

export const frontmatterParse: Executor = async (input) => {
  const text = str(input);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return fail("No YAML frontmatter block found.");
  const data: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    const raw = pair[2].trim().replace(/^["']|["']$/g, "");
    data[pair[1]] = raw === "true" ? true : raw === "false" ? false
      : raw && Number.isFinite(Number(raw)) && String(Number(raw)) === raw ? Number(raw)
      : raw.startsWith("[") ? raw.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : raw;
  }
  return ok({ frontmatter: data, body: match[2].trim() }, "application/json");
};

export const languageDetect: Executor = async (input) => {
  const text = str(input);
  if (!text.trim()) return fail("Nothing to inspect.");
  const scripts: Array<[string, RegExp]> = [
    ["Latin", /[a-zA-Z]/g], ["Hebrew", /[֐-׿]/g], ["Arabic", /[؀-ۿ]/g],
    ["Cyrillic", /[Ѐ-ӿ]/g], ["Greek", /[Ͱ-Ͽ]/g],
    ["Han", /[一-鿿]/g], ["Hiragana/Katakana", /[぀-ヿ]/g], ["Hangul", /[가-힯]/g],
    ["Devanagari", /[ऀ-ॿ]/g]
  ];
  const counts = scripts
    .map(([name, re]) => ({ script: name, count: (text.match(re) ?? []).length }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  if (!counts.length) return fail("No recognisable script found.");
  // Only a script guess. Distinguishing languages inside one script needs a model.
  return ok({
    dominantScript: counts[0].script,
    distribution: counts,
    note: "Script detection only. Telling apart languages that share a script is not something this can do."
  }, "application/json");
};
