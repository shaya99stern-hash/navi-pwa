import { readFileSync } from "node:fs";
import { join } from "node:path";
import { csvToMarkdown, documentBlock, parseCsv } from "@/lib/ai/document-text";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The naive split is why this needs a parser ──────────────────────────────
   `line.split(",")` breaks on the first quoted comma, and a table that shifts
   by one column halfway down is worse than no table — the model reads it as
   data rather than as damage. */

check("a quoted comma stays one field",
  parseCsv('name,note\nSam,"Cambridge, MA"'),
  [["name", "note"], ["Sam", "Cambridge, MA"]]);
check("a doubled quote is one literal quote",
  parseCsv('a\n"He said ""hi"""'),
  [["a"], ['He said "hi"']]);
check("a newline inside quotes does not end the row",
  parseCsv('a,b\n"one\ntwo",three'),
  [["a", "b"], ["one\ntwo", "three"]]);
check("carriage returns are handled", parseCsv("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
check("blank lines are dropped", parseCsv("a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
check("empty input yields nothing", parseCsv(""), []);
check("a trailing field with no newline survives", parseCsv("a,b"), [["a", "b"]]);

/* ── A table, not raw CSV ────────────────────────────────────────────────── */

const table = csvToMarkdown("name,city\nSam,Boston\nAlex,Berlin");
check("a header row is rendered", table.text.includes("| name | city |"), true);
check("a separator follows it", table.text.includes("| --- | --- |"), true);
check("data rows follow", table.text.includes("| Sam | Boston |"), true);
check("a small table is not truncated", table.truncated, false);

// A pipe in a cell would otherwise break the table it is rendered into.
check("pipes are escaped", csvToMarkdown("a\nx|y").text.includes("x\\|y"), true);
// Ragged rows are padded rather than shifting every later column.
check("short rows are padded", csvToMarkdown("a,b,c\n1").text.includes("| 1 |  |  |"), true);

/* Truncation is stated rather than silent. A model that does not know it read
   part of a file will answer as though it read all of one. */
const many = csvToMarkdown(["h"].concat(Array.from({ length: 400 }, (_, i) => String(i))).join("\n"));
check("a long table is truncated", many.truncated, true);
check("and says how much it showed", /Showing the first 200 of 401 rows/.test(many.text), true);

const wide = csvToMarkdown(Array.from({ length: 30 }, (_, i) => `c${i}`).join(",") + "\n" + Array.from({ length: 30 }, () => "x").join(","));
check("a wide table is narrowed", wide.truncated, true);
check("and says so", /Showing the first 12 columns/.test(wide.text), true);

check("empty csv yields nothing", csvToMarkdown("").text, "");

/* ── Truncation reaches the model in words ───────────────────────────────── */

const cut = documentBlock("contract.pdf", { text: "body", truncated: true, pages: 40 });
check("the name and page count are stated", cut.includes("contract.pdf · 40 pages"), true);
check("truncation is stated to the model", /longer than the limit and has been cut/.test(cut), true);
check("the model is told to say so", /Say so if the answer depends on what came after/.test(cut), true);

const whole = documentBlock("notes.csv", { text: "body", truncated: false });
check("a whole document says nothing about cutting", /cut here/.test(whole), false);
check("a document with no pages omits the count", whole.includes("·"), false);

/* ── Read against the source ─────────────────────────────────────────────── */

const root = process.cwd();
const doc = readFileSync(join(root, "lib/ai/document-text.ts"), "utf8");
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");

/* Null is the signal to fall back to vision rather than an error, because for
   a scan vision is the correct tool rather than a degraded one. */
check("a scan falls back to vision", doc.includes("if (merged.length < 40) return null"), true);
check("an extraction failure falls back too", doc.includes("return null;"), true);
/* Compared in the body, not against the import — `convertToModelMessages`
   appears on line 2 as an import, so an unqualified indexOf compares an import
   against a call and passes or fails for the wrong reason. */
const routeBody = route.slice(route.lastIndexOf("\nimport "));
check("pdf text is extracted before the model call",
  routeBody.indexOf("await extractDocuments(messages)") < routeBody.indexOf("convertToModelMessages(redactGeneratedMedia"), true);
check("documents sit with the volatile tail", route.indexOf("stablePrefix(") < route.indexOf('documents || ""'), true);
check("the model is told it is text, not a picture", route.includes("not a picture of it"), true);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check("the extractor is a dependency", Boolean(pkg.dependencies.unpdf), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
