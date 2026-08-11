/** Markdown handling that does not need a parser dependency. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const lines = (input: Record<string, unknown>) => str(input).split(/\r?\n/);

export const mdToText: Executor = async (input) => {
  const out = str(input)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?/gi, ""))
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, "");
  return ok(out.trim());
};

export const mdTable: Executor = async (input) => {
  const rows = lines(input).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\t|\s*[,|]\s*/).map((c) => c.trim()));
  if (rows.length < 2) return fail("Give a header row and at least one data row, comma- or tab-separated.");
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  const sizes = Array.from({ length: width }, (_, i) => Math.max(3, ...padded.map((r) => r[i].length)));
  const align = String(input.align ?? "left");
  const rule = sizes.map((s) => align === "right" ? `${"-".repeat(s - 1)}:` : align === "center" ? `:${"-".repeat(s - 2)}:` : "-".repeat(s));
  const render = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(sizes[i])).join(" | ")} |`;
  return ok([render(padded[0]), `| ${rule.join(" | ")} |`, ...padded.slice(1).map(render)].join("\n"));
};

export const mdEscape: Executor = async (input) => {
  const text = str(input);
  if (!text) return fail("Give text to escape.");
  return ok(text.replace(/([\\`*_{}[\]()#+\-.!|>~])/g, "\\$1"));
};

export const mdLinkList: Executor = async (input) => {
  const found = [...str(input).matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)];
  const bare = [...str(input).matchAll(/(?<!\()\bhttps?:\/\/[^\s)<>\]]+/g)];
  if (!found.length && !bare.length) return ok("No links found.");
  const rows = [
    ...found.map((m) => `${m[1]}\n  ${m[2]}`),
    ...bare.map((m) => `(bare)\n  ${m[0]}`)
  ];
  return ok(`${rows.length} link${rows.length === 1 ? "" : "s"}:\n\n${rows.join("\n")}`);
};

export const mdHeadingTree: Executor = async (input) => {
  const heads = lines(input).map((l) => /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  if (!heads.length) return ok("No headings found.");
  return ok(heads.map((h) => `${"  ".repeat(h[2].length - 1)}${h[2].length}. ${h[3].trim()}`).join("\n"));
};

export const mdChecklist: Executor = async (input) => {
  const items = lines(input).map((l) => l.replace(/^\s*(?:[-*+]\s*)?(?:\[[ xX]\]\s*)?/, "").trim()).filter(Boolean);
  if (!items.length) return fail("Give one item per line.");
  const checked = input.checked === true;
  return ok(items.map((i) => `- [${checked ? "x" : " "}] ${i}`).join("\n"));
};

export const mdFootnotes: Executor = async (input) => {
  const text = str(input);
  const refs = [...text.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1]);
  const defined = new Set([...text.matchAll(/^\[\^([^\]]+)\]:/gm)].map((m) => m[1]));
  const used = [...new Set(refs.filter((r) => !defined.has(r)))];
  const orphaned = [...defined].filter((d) => !refs.includes(d));
  return ok([
    `${new Set(refs).size} reference${new Set(refs).size === 1 ? "" : "s"}, ${defined.size} definition${defined.size === 1 ? "" : "s"}.`,
    used.length ? `Missing definitions: ${used.join(", ")}` : "",
    orphaned.length ? `Defined but never referenced: ${orphaned.join(", ")}` : "",
    used.length ? `\nStubs:\n${used.map((u) => `[^${u}]: `).join("\n")}` : ""
  ].filter(Boolean).join("\n"));
};

export const mdCodeFence: Executor = async (input) => {
  const text = str(input);
  if (!text) return fail("Give code to fence.");
  const language = String(input.language ?? input.lang ?? "");
  /* A fence must be longer than the longest run of backticks it contains,
     otherwise pasted code closes the block early. */
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return ok(`${fence}${language}\n${text}\n${fence}`);
};

export const mdBadge: Executor = async (input) => {
  const label = str(input, "label") || str(input) || "build";
  const message = str(input, "message") || "passing";
  const color = str(input, "color") || "brightgreen";
  const enc = (s: string) => encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));
  const url = `https://img.shields.io/badge/${enc(label)}-${enc(message)}-${enc(color)}`;
  return ok(`![${label}](${url})\n\nWith a link:\n[![${label}](${url})](https://example.com)`);
};

export const mdTocLinks: Executor = async (input) => {
  const heads = lines(input).map((l) => /^(#{1,6})\s+(.*)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  if (!heads.length) return ok("No headings found.");
  const seen = new Map<string, number>();
  const rows = heads.map((h) => {
    const title = h[2].trim().replace(/[*_`]/g, "");
    /* GitHub's slug rules: lowercase, strip punctuation, spaces to hyphens,
       and a numeric suffix for repeats. */
    let slug = title.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    if (count) slug = `${slug}-${count}`;
    return `${"  ".repeat(h[1].length - 1)}- [${title}](#${slug})`;
  });
  return ok(rows.join("\n"));
};

export const mdBlockquote: Executor = async (input) => {
  const text = str(input);
  if (!text) return fail("Give text to quote.");
  const kind = String(input.type ?? "").toUpperCase();
  const valid = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
  const body = text.split(/\r?\n/).map((l) => `> ${l}`).join("\n");
  return ok(valid.includes(kind) ? `> [!${kind}]\n${body}` : body);
};

export const mdStripFormatting: Executor = async (input) => {
  const text = str(input);
  if (!text) return fail("Give markdown.");
  return ok(text.replace(/(\*\*|__|\*|_|~~|`)/g, ""));
};
