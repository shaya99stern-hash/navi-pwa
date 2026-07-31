import type { Executor, SkillResult } from "../registry";

export const ok = (output: unknown, mime = "text/plain"): SkillResult => ({ ok: true, output, mime });
export const fail = (error: string): SkillResult => ({ ok: false, error });

/**
 * Every skill takes free text as `text`, so slash commands can pass their tail.
 * Numbers and booleans are coerced because the argument parser types
 * `value=1994` as a number, and a skill asking for text should still see it.
 */
export const str = (input: Record<string, unknown>, key = "text"): string => {
  const value = input[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const num = (input: Record<string, unknown>, key: string, fallback: number): number => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

export const changeCase: Executor = async (input) => {
  const text = str(input);
  const mode = String(input.mode ?? "title").toLowerCase();
  const words = text.trim().split(/[\s_-]+/).filter(Boolean);
  switch (mode) {
    case "upper": return ok(text.toUpperCase());
    case "lower": return ok(text.toLowerCase());
    case "sentence": return ok(text.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase()));
    case "camel": return ok(words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(""));
    case "pascal": return ok(words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(""));
    case "snake": return ok(words.map((w) => w.toLowerCase()).join("_"));
    case "kebab": return ok(words.map((w) => w.toLowerCase()).join("-"));
    default: return ok(text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()));
  }
};

export const slugify: Executor = async (input) =>
  ok(str(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, ""));

export const trimWhitespace: Executor = async (input) =>
  ok(str(input).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n").trim());

export const dedupeLines: Executor = async (input) => {
  const lines = str(input).split("\n");
  const seen = new Set<string>();
  const kept = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  return ok(`${kept.join("\n")}\n\n— removed ${lines.length - kept.length} duplicate line(s)`);
};

export const sortLines: Executor = async (input) => {
  const mode = String(input.mode ?? "alpha");
  const lines = str(input).split("\n").filter((l) => l.length);
  const sorted = mode === "numeric" ? lines.sort((a, b) => parseFloat(a) - parseFloat(b))
    : mode === "length" ? lines.sort((a, b) => a.length - b.length)
    : lines.sort((a, b) => a.localeCompare(b));
  if (input.reverse) sorted.reverse();
  return ok(sorted.join("\n"));
};

export const reverseText: Executor = async (input) => {
  const mode = String(input.mode ?? "characters");
  const text = str(input);
  if (mode === "words") return ok(text.split(/\s+/).reverse().join(" "));
  if (mode === "lines") return ok(text.split("\n").reverse().join("\n"));
  return ok([...text].reverse().join(""));
};

export const wordCharCount: Executor = async (input) => {
  const text = str(input);
  return ok({
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, "")].length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    lines: text ? text.split("\n").length : 0,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    bytes: new TextEncoder().encode(text).length
  }, "application/json");
};

export const wrapText: Executor = async (input) => {
  const width = Math.max(8, num(input, "width", 80));
  const indent = String(input.indent ?? "");
  return ok(str(input).split("\n").flatMap((paragraph) => {
    if (!paragraph.trim()) return [""];
    const out: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && (line + " " + word).length > width) { out.push(indent + line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(indent + line);
    return out;
  }).join("\n"));
};

export const findReplace: Executor = async (input) => {
  const find = String(input.find ?? "");
  if (!find) return fail("Nothing to find.");
  const replace = String(input.replace ?? "");
  try {
    const pattern = input.regex
      ? new RegExp(find, String(input.flags ?? "g"))
      : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const text = str(input);
    const count = (text.match(pattern) ?? []).length;
    return ok(`${text.replace(pattern, replace)}\n\n— ${count} replacement(s)`);
  } catch (error) {
    return fail(`Invalid pattern: ${(error as Error).message}`);
  }
};

export const joinLines: Executor = async (input) =>
  ok(str(input).split("\n").filter((l) => l.trim()).join(String(input.delimiter ?? ", ")));

export const numberLines: Executor = async (input) => {
  const start = num(input, "start", 1);
  const lines = str(input).split("\n");
  const pad = String(lines.length + start - 1).length;
  return ok(lines.map((l, i) => `${String(i + start).padStart(pad, " ")}. ${l}`).join("\n"));
};

export const removeEmptyLines: Executor = async (input) =>
  ok(str(input).split("\n").filter((l) => l.trim()).join("\n"));

export const smartQuotes: Executor = async (input) => {
  const text = str(input);
  if (input.straighten) {
    return ok(text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, "--").replace(/…/g, "..."));
  }
  return ok(text
    .replace(/(^|[\s([{])"/g, "$1“").replace(/"/g, "”")
    .replace(/(^|[\s([{])'/g, "$1‘").replace(/'/g, "’")
    .replace(/--/g, "—").replace(/\.\.\./g, "…"));
};

const LOREM = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et "
  + "dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo "
  + "consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur").split(" ");

export const loremIpsum: Executor = async (input) => {
  const count = Math.min(50, Math.max(1, num(input, "count", 3)));
  const unit = String(input.unit ?? "paragraphs");
  const pick = (n: number) => Array.from({ length: n }, (_, i) => LOREM[(i * 7 + n) % LOREM.length]);
  if (unit === "words") return ok(pick(count).join(" "));
  return ok(Array.from({ length: count }, (_, p) => {
    const sentence = pick(18 + (p % 9));
    const text = sentence.join(" ");
    return text[0].toUpperCase() + text.slice(1) + ".";
  }).join("\n\n"));
};

/** Line-level LCS diff — enough to see what moved without a dependency. */
export const textDiff: Executor = async (input) => {
  const a = str(input, "a").split("\n");
  const b = str(input, "b").split("\n");
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(`  ${a[i]}`); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push(`- ${a[i]}`); i += 1; }
    else { out.push(`+ ${b[j]}`); j += 1; }
  }
  while (i < a.length) { out.push(`- ${a[i]}`); i += 1; }
  while (j < b.length) { out.push(`+ ${b[j]}`); j += 1; }
  return ok(out.join("\n"));
};

export const splitText: Executor = async (input) => {
  const text = str(input);
  const by = String(input.by ?? "delimiter");
  if (by === "length") {
    const size = Math.max(1, num(input, "size", 280));
    return ok((text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? []).join("\n---\n"));
  }
  return ok(text.split(String(input.delimiter ?? ",")).map((p) => p.trim()).join("\n"));
};
