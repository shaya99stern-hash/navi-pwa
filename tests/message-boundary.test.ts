import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── "There was an error and it took me to a different page" ─────────────────
   The owner said that while making artifacts, and the cause was structural:
   this app had no error boundary anywhere in its component tree. The only one
   was Next's route-level `app/error.tsx`, which is a whole-page fallback by
   design.

   So any render-time throw in the thread — a malformed artifact payload, one
   unexpected shape in one saved message — replaced the entire screen. The
   conversation was still safe on the device and the fallback page says so, but
   the person was no longer looking at it. Everything they were doing vanished
   from view because one paragraph would not draw. */

const root = process.cwd();
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const boundary = readFileSync(join(root, "app/components/message-boundary.tsx"), "utf8");
const boundaryCode = strip(boundary);
const row = readFileSync(join(root, "app/components/message-row.tsx"), "utf8");

/* A message is the right size for a boundary: it is the unit that failed, it is
   independently meaningful, and the rest of the conversation is unrelated. */
check("a boundary exists at the message", /class MessageBoundary extends Component/.test(boundaryCode), true);
check("it catches render errors", /static getDerivedStateFromError\(\)/.test(boundaryCode), true);
check("and every rendered message is inside one",
  /<MessageBoundary text=\{text\}>\s*<MarkdownRenderer/.test(row), true);

/* A reply that cannot be *formatted* has not stopped existing. Losing the
   content because the markdown pass threw would be worse than the error. */
check("the text survives a failed render",
  /\{this\.props\.text\}/.test(boundaryCode), true);
check("and the reader is told what happened rather than shown a stack",
  boundary.includes("This reply could not be formatted, so it is shown as plain text"), true);
check("with the rest of the conversation explicitly unaffected",
  boundary.includes("The rest of the conversation is unaffected"), true);

/* A half-written fence is malformed for as long as it is partial and valid a
   second later. Staying broken for the life of the message would be the wrong
   memory, and it is the shape most likely to bite while streaming. */
check("a new version of the text is a new attempt",
  /state\.forText !== props\.text/.test(boundaryCode), true);
check("the failure does not outlive the text that caused it",
  /failed: false, forText: props\.text/.test(boundaryCode), true);

/* The stack goes where whoever is debugging will look for it, not into the
   middle of somebody's conversation. */
check("the error is logged for the console", /console\.error\("Navi message failed to render:"/.test(boundaryCode), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
