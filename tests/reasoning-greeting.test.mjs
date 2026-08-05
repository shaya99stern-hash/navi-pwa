import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const disclosure = readFileSync(join(root, "app/components/reasoning-disclosure.tsx"), "utf8");
const row = readFileSync(join(root, "app/components/message-row.tsx"), "utf8");
const launch = readFileSync(join(root, "app/components/launch-surface.tsx"), "utf8");
const shell = readFileSync(join(root, "app/components/app-shell.tsx"), "utf8");

/* ── Two different problems, one switch ──────────────────────────────────────
   The trace is unsafe to *replay* — a provider that rejects
   `reasoning_content` breaks the conversation permanently, and lane fallback
   makes that likely rather than rare. It was never unsafe to *show*. Solving
   both with `sendReasoning: false` meant extended thinking never reached the
   screen, which is most of why thinking harder felt like it did nothing. */

check("reasoning now reaches the screen", route.includes("sendReasoning: true"), true);
check("reasoning is still stripped from the replay", route.includes('.filter((part) => part.type !== "reasoning")'), true);
/* Both must hold at once. Either alone is a regression: dropping the filter
   breaks conversations, and dropping the flag hides the work again. */
check("the replay stripper explains why it stays", /permanently broken conversation/.test(route), true);

/* ── The disclosure ──────────────────────────────────────────────────────── */

check("it is collapsed by default", disclosure.includes("useState(false)"), true);
check("it is expandable", disclosure.includes("aria-expanded={open}"), true);
check("it says it is thinking while it is", disclosure.includes('"Thinking…"'), true);
check("it settles into the past tense", disclosure.includes('"Thought about this"'), true);
/* Quieter than prose on purpose: this is working-out, and styling it like the
   answer invites reading it as one. */
check("it is styled below prose", disclosure.includes("text-tertiary"), true);
check("a long trace scrolls rather than pushing the answer away", disclosure.includes("max-h-72"), true);

/* After a reload the text is gone because it is never persisted, but the fact
   survives — otherwise reopening a chat silently removes a disclosure the user
   watched appear, which reads as the app losing something. */
check("the fact of reasoning outlives the text", disclosure.includes("export function hadReasoning"), true);
check("a reloaded turn says the notes are not kept", disclosure.includes("the notes are not kept"), true);
check("the trace placeholder is only for settled turns", row.includes("!streaming && hadReasoning(message)"), true);

/* Placed with the plan: the same disclosure surface, above the answer.
   Compared on the JSX, not the imports — import order says nothing about what
   renders first, and comparing it passes or fails for the wrong reason. */
const body = row.slice(row.lastIndexOf("import "));
check("reasoning renders above the answer", body.indexOf("<ReasoningDisclosure") < body.indexOf("<MarkdownRenderer"), true);
check("the plan comes before the thinking", body.indexOf("<PlanCard") < body.indexOf("<ReasoningDisclosure"), true);
check("both sit above the answer", body.indexOf("<PlanCard") < body.indexOf("<MarkdownRenderer"), true);

/* ── The greeting addresses the user ─────────────────────────────────────── */

check("the name is accepted", /name\?: string/.test(launch), true);
check("the shell passes the display name", shell.includes("name={preferences.profile.displayName || undefined}"), true);
/* A name turns the line into an address, so the bare time-of-day form is the
   only one that reads correctly beside it. */
check("a name yields the plain form", /\$\{part\}, \$\{name\}/.test(launch), true);
check("the parts are time-of-day", /Late night|Morning|Afternoon|Evening/.test(launch), true);
// With no name the rotation stands; a placeholder is worse than the variety.
check("no name keeps the rotation", launch.includes("setGreeting(greetingForNow(new Date()))"), true);
check("there is no placeholder name", /there|friend|user/i.test(launch.slice(launch.indexOf("if (name)"), launch.indexOf("if (name)") + 400)), false);
check("the effect follows the name", launch.includes("}, [name]);"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
