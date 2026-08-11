/** Set and list operations on plain lines. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const items = (input: Record<string, unknown>, key = "text") =>
  str(input, key).split(/\r?\n/).flatMap((l) => (l.includes(",") && !l.includes("\t") ? l.split(",") : [l])).map((s) => s.trim()).filter(Boolean);

/** Two lists, given as `a` and `b`, or split on a blank line. */
function twoLists(input: Record<string, unknown>): [string[], string[]] | null {
  if (input.a !== undefined && input.b !== undefined) return [items(input, "a"), items(input, "b")];
  const blocks = str(input).split(/\r?\n\s*\r?\n/);
  if (blocks.length >= 2) return [items({ text: blocks[0] }), items({ text: blocks.slice(1).join("\n") })];
  return null;
}

export const listUnique: Executor = async (input) => {
  const all = items(input);
  if (!all.length) return fail("Give a list, one item per line.");
  const caseInsensitive = input.ignoreCase === true;
  const seen = new Set<string>();
  const out: string[] = [];
  let removed = 0;
  for (const item of all) {
    const key = caseInsensitive ? item.toLowerCase() : item;
    if (seen.has(key)) { removed += 1; continue; }
    seen.add(key);
    out.push(item);
  }
  return ok(`${out.join("\n")}\n\n(${out.length} kept, ${removed} duplicate${removed === 1 ? "" : "s"} removed)`);
};

const setOp = (name: string, fn: (a: string[], b: string[]) => string[]): Executor => async (input) => {
  const pair = twoLists(input);
  if (!pair) return fail(`Give two lists, separated by a blank line, or as a= and b=.`);
  const result = fn(pair[0], pair[1]);
  return ok(result.length ? `${result.join("\n")}\n\n(${result.length} in the ${name})` : `Nothing in the ${name}.`);
};

export const listIntersect = setOp("intersection", (a, b) => { const s = new Set(b); return [...new Set(a.filter((x) => s.has(x)))]; });
export const listDifference = setOp("difference", (a, b) => { const s = new Set(b); return [...new Set(a.filter((x) => !s.has(x)))]; });
export const listUnion = setOp("union", (a, b) => [...new Set([...a, ...b])]);

export const listShuffle: Executor = async (input) => {
  const all = items(input);
  if (all.length < 2) return fail("Give at least two items.");
  const out = [...all];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    const j = buffer[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return ok(out.join("\n"));
};

export const listChunk: Executor = async (input) => {
  const all = items(input);
  const size = Math.max(1, Number(input.size) || 3);
  if (!all.length) return fail("Give a list.");
  const chunks: string[][] = [];
  for (let i = 0; i < all.length; i += size) chunks.push(all.slice(i, i + size));
  return ok(chunks.map((c, i) => `${i + 1}. ${c.join(", ")}`).join("\n"));
};

export const listFlatten: Executor = async (input) => {
  const text = str(input);
  try {
    const parsed = JSON.parse(text);
    const flat = (Array.isArray(parsed) ? parsed : [parsed]).flat(Infinity);
    return ok(flat.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("\n"));
  } catch {
    return ok(items(input).join("\n"));
  }
};

export const listZip: Executor = async (input) => {
  const pair = twoLists(input);
  if (!pair) return fail("Give two lists, separated by a blank line, or as a= and b=.");
  const [a, b] = pair;
  const joiner = String(input.delimiter ?? " — ");
  const length = Math.max(a.length, b.length);
  const rows = Array.from({ length }, (_, i) => `${a[i] ?? ""}${joiner}${b[i] ?? ""}`);
  return ok(rows.join("\n") + (a.length !== b.length ? `\n\n(lists differ in length: ${a.length} vs ${b.length})` : ""));
};

export const listRotate: Executor = async (input) => {
  const all = items(input);
  if (!all.length) return fail("Give a list.");
  const by = ((Number(input.by) || 1) % all.length + all.length) % all.length;
  return ok([...all.slice(by), ...all.slice(0, by)].join("\n"));
};

export const listSample: Executor = async (input) => {
  const all = items(input);
  if (!all.length) return fail("Give a list.");
  const count = Math.min(all.length, Math.max(1, Number(input.count) || 1));
  const pool = [...all];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    out.push(...pool.splice(buffer[0] % pool.length, 1));
  }
  return ok(out.join("\n"));
};

export const listFrequency: Executor = async (input) => {
  const all = items(input);
  if (!all.length) return fail("Give a list.");
  const counts = new Map<string, number>();
  for (const item of all) counts.set(item, (counts.get(item) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const width = String(sorted[0][1]).length;
  return ok(sorted.map(([k, v]) => `${String(v).padStart(width)}  ${k}`).join("\n"));
};

export const listPartition: Executor = async (input) => {
  const all = items(input);
  const pattern = String(input.match ?? input.pattern ?? "");
  if (!all.length) return fail("Give a list.");
  if (!pattern) return fail("Give match= as text or a regular expression.");
  let test: (s: string) => boolean;
  try {
    const re = new RegExp(pattern, String(input.flags ?? "i"));
    test = (s) => re.test(s);
  } catch {
    test = (s) => s.toLowerCase().includes(pattern.toLowerCase());
  }
  const yes = all.filter(test);
  const no = all.filter((s) => !test(s));
  return ok(`matched (${yes.length}):\n${yes.join("\n") || "  —"}\n\nunmatched (${no.length}):\n${no.join("\n") || "  —"}`);
};
