import { read } from "./source.mjs";

/**
 * Project files, and the budget that keeps them from becoming the next
 * 20,000-token prompt.
 *
 * Projects carried a name, instructions and typed notes, which made them a
 * system prompt with a label. Files are what turns that into a knowledge base.
 *
 * The risk is specific and it is the same one that took this app down: a
 * project is replayed into *every* conversation that belongs to it, so an
 * unbounded knowledge base is a permanent tax on every request rather than a
 * one-off cost — and it would arrive at the routing budget from a direction
 * nothing was measuring. Every assertion here is about a bound.
 */

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const route = read("app/api/projects/knowledge/route.ts");
const chat = read("app/api/chat/route.ts");
const storage = read("lib/storage/indexeddb.ts");
const sheet = read("app/components/projects-sheet.tsx");
const types = read("lib/ai/types.ts");

/* ── The text is stored, never the file ─────────────────────────────────── */

/* Keeping the bytes would mean carrying a PDF into every turn that needs a
   paragraph of it. The stored shape is text, and the type says so. */
check("a project document is text", /text: string;/.test(types.code), true);
check("with the filename kept, so a fact can be attributed",
  /name: string;/.test(types.code), true);
check("and a flag when the file was longer than one document may contribute",
  /truncated: boolean;/.test(types.code), true);
check("documents are optional, so projects saved before this still load",
  /documents\?: ProjectDocument\[\];/.test(types.code), true);

/* ── Bounded at upload ──────────────────────────────────────────────────── */

check("the upload itself is capped", /MAX_UPLOAD_CHARS/.test(route.code), true);
check("and what one document may contribute is capped separately",
  /const MAX_DOCUMENT_CHARS = 12_000;/.test(route.code), true);
check("truncation is reported rather than silent",
  /truncated: boolean/.test(route.code) && /truncated \? /.test(route.code), true);
/* A scan has no text layer. Storing an empty knowledge item would contribute
   nothing to every future conversation, silently. */
check("a PDF with no text layer is refused, not stored empty",
  /may be a scan/.test(route.source), true);
check("an unreadable type is refused with the types that work",
  /PDF, CSV, JSON, and plain text work/.test(route.source), true);

/* ── Bounded again on the way back off the device ───────────────────────── */

/* This reads whatever is on disk, which includes records written by an older
   build and by cloud sync from another device. */
check("storage re-bounds each document's text",
  /text: text\.slice\(0, 12_000\)/.test(storage.code), true);
check("and caps how many a project may hold",
  /\.slice\(0, 20\)/.test(storage.code), true);
check("a document with no text is dropped rather than kept as an empty entry",
  /if \(typeof document\.id !== "string" \|\| !text\.trim\(\)\) return \[\];/.test(storage.code), true);

/* ── Bounded a third time on the way into a prompt ──────────────────────── */

check("the prompt reserves a fixed budget for project documents",
  /const MAX_PROJECT_DOCUMENT_CHARS = 16_000;/.test(chat.code), true);
check("spent across documents rather than per document",
  /documentBudget -= text\.length;/.test(chat.code), true);
check("and the loop stops when it is gone",
  /if \(documentBudget <= 0\) break;/.test(chat.code), true);
/* Named individually, or a project's own files get cited as though they were
   the web. */
check("each document is named in the prompt",
  /### \$\{document\.name\}/.test(chat.source), true);
check("and the model is told to attribute facts to them",
  /name the document when a fact comes from one/.test(chat.source), true);
check("documents are declared durable user context, not an external source",
  /Treat project instructions, knowledge, and documents as durable user-provided context/.test(chat.source), true);

/* The whole point: they have to reach the request. */
check("the client sends them with the project context",
  /documents: activeProject\.documents/.test(read("app/components/app-shell.tsx").code), true);

/* ── The sheet ──────────────────────────────────────────────────────────── */

check("files can be added", /\/api\/projects\/knowledge/.test(sheet.code), true);
check("a failure names the file it happened to",
  /failed\.push\(`\$\{file\.name\}/.test(sheet.source), true);
/* Silently storing a twenty-first document that vanishes on the next load is
   worse than refusing it — the cap here matches the one storage enforces. */
check("the sheet caps at the same twenty storage keeps",
  /\]\.slice\(0, 20\)\s*\}\)/.test(sheet.code), true);
check("and a document can be removed again",
  /aria-label=\{`Remove \$\{document\.name\}`\}/.test(sheet.source), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
