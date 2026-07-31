import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

export const jsonFormat: Executor = async (input) => {
  try {
    return ok(JSON.stringify(JSON.parse(str(input)), null, Number(input.indent) || 2), "application/json");
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
};

export const jsonMinify: Executor = async (input) => {
  try {
    return ok(JSON.stringify(JSON.parse(str(input))), "application/json");
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
};

export const jsonValidate: Executor = async (input) => {
  const text = str(input);
  try {
    JSON.parse(text);
    return ok(`Valid JSON — ${text.length} characters.`);
  } catch (error) {
    const message = (error as Error).message;
    const position = /position (\d+)/.exec(message);
    if (!position) return fail(message);
    const offset = Number(position[1]);
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    return fail(`${message}\n  → line ${line}, column ${column}\n  ${text.slice(Math.max(0, offset - 30), offset + 30).replace(/\n/g, "⏎")}`);
  }
};

function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => flatten(child, `${prefix}[${index}]`, out));
  } else {
    out[prefix] = value;
  }
  return out;
}

export const jsonFlatten: Executor = async (input) => {
  try {
    return ok(flatten(JSON.parse(str(input))), "application/json");
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
};

/** Splits on unquoted commas, so quoted fields containing commas survive. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const csvToJson: Executor = async (input) => {
  const text = str(input).trim();
  if (!text) return fail("Nothing to parse.");
  const delimiter = String(input.delimiter ?? (text.includes("\t") ? "\t" : ","));
  const rows = parseCsv(text, delimiter);
  if (rows.length < 1) return fail("No rows found.");
  const headers = rows[0].map((h) => h.trim());
  const typed = input.raw !== true;
  const records = rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => {
    const raw = (row[index] ?? "").trim();
    if (!typed) return [header, raw];
    if (raw === "") return [header, null];
    if (raw === "true" || raw === "false") return [header, raw === "true"];
    // Only convert when the text round-trips, so "007" and "1-2" stay strings.
    const n = Number(raw);
    return [header, Number.isFinite(n) && String(n) === raw ? n : raw];
  })));
  return ok(records, "application/json");
};

export const jsonToCsv: Executor = async (input) => {
  let data: unknown;
  try {
    data = JSON.parse(str(input));
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
  const rows = Array.isArray(data) ? data : [data];
  if (!rows.length) return fail("No rows to write.");
  const headers = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : [])))];
  if (!headers.length) return fail("Expected an array of objects.");
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => headers.map((h) => escape((row as Record<string, unknown>)?.[h])).join(","));
  return ok([headers.join(","), ...body].join("\n"), "text/csv");
};

export const ndjsonSplit: Executor = async (input) => {
  const text = str(input).trim();
  try {
    if (input.merge) {
      const items = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
      return ok(JSON.stringify(items, null, 2), "application/json");
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return fail("Expected a JSON array to split.");
    return ok(parsed.map((item) => JSON.stringify(item)).join("\n"), "application/x-ndjson");
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
};

/** Dot/bracket path lookup. Not full JSONPath, and says so rather than pretending. */
export const jsonPathQuery: Executor = async (input) => {
  const path = String(input.path ?? "").replace(/^\$\.?/, "");
  if (!path) return fail("Provide a `path` such as user.address[0].city.");
  let data: unknown;
  try {
    data = JSON.parse(str(input));
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
  let cursor: unknown = data;
  for (const segment of path.split(/[.[\]]+/).filter(Boolean)) {
    if (cursor === null || cursor === undefined) return fail(`Path stops at "${segment}" — the parent is empty.`);
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === undefined) return fail(`Nothing found at "${path}".`);
  return ok(cursor, "application/json");
};

export const jsonDiff: Executor = async (input) => {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(str(input, "a"));
    b = JSON.parse(str(input, "b"));
  } catch (error) {
    return fail(`Invalid JSON: ${(error as Error).message}`);
  }
  const left = flatten(a);
  const right = flatten(b);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const inLeft = key in left;
    const inRight = key in right;
    if (inLeft && !inRight) removed[key] = left[key];
    else if (!inLeft && inRight) added[key] = right[key];
    else if (left[key] !== right[key]) changed[key] = { from: left[key], to: right[key] };
  }
  return ok({ added, removed, changed, identical: !Object.keys(added).length && !Object.keys(removed).length && !Object.keys(changed).length }, "application/json");
};
