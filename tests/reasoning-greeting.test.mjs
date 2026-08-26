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
check("the replay stripper explains why it stays", /permanently broken conversation/.test(route), true);

/* ── The disclosure ──────────────────────────────────────────────────────── */

check("it is collapsed by default", disclosure.includes("useState(false)"), true);
check("it is expandable", disclosure.includes("aria-expanded={open}"), true);
check("it says it is thinking while it is", disclosure.includes('"Thinking…"'), true);
check("it settles into the past tense", disclosure.includes('"Thought about this"'), true);
check("it is styled below prose", disclosure.includes("text-tertiary"), true);
check("a long trace scrolls rather than pushing the answer away", disclosure.includes("max-h-72"), true);
check("the fact of reasoning outlives the text", disclosure.includes("export function hadReasoning"), true);
check("a reloaded turn says the notes are not kept", disclosure.includes("the notes are not kept"), true);
check("the trace placeholder is only for settled turns", row.includes("!streaming && hadReasoning(message)"), true);

const body = row.slice(row.lastIndexOf("import "));
check("reasoning renders above the answer", body.indexOf("<ReasoningDisclosure") < body.indexOf("<MarkdownRenderer"), true);
check("the plan comes before the thinking", body.indexOf("<PlanCard") < body.indexOf("<ReasoningDisclosure"), true);
check("both sit above the answer", body.indexOf("<PlanCard") < body.indexOf("<MarkdownRenderer"), true);

/* ── The greeting addresses the user ─────────────────────────────────────── */

check("the name is accepted", /name\?: string/.test(launch), true);
check("the greeting is centred with the launch surface", /items-center justify-center text-center/.test(launch), true);
check("the Navi mark sits above the greeting", launch.indexOf("<NaviMark") < launch.indexOf("<h1"), true);
check("the Navi mark stays compact", /home-welcome-mark[^\"]*h-7 w-7/.test(launch), true);
check("the greeting is no longer 2rem", launch.includes("text-[2rem]/[2.375rem]"), false);

/* In flow and responsive: thread title must share the header's free space
   instead of being absolutely centred under asymmetrical controls. */
check("the header title sits in the flow", /flex-1[^\"]*min-w-0|min-w-0[^\"]*flex-1/.test(shell), true);
check("the title is no longer absolutely centred", /absolute bottom-0 left-1\/2 top-\[var\(--safe-top\)\]/.test(shell), false);
check("no spacer is needed any more", shell.includes('<div className="flex-1" aria-hidden="true" />'), false);
check("no width cap is needed any more", /max-w-\[calc\(100%-184px\)\]/.test(shell), false);
check("the thread label truncates", /truncate[^\"]*text-\[17px\]|text-\[17px\][^\"]*truncate/.test(shell), true);
check("chat actions come before new chat", shell.indexOf("<Ellipsis") < shell.indexOf("<SquarePen"), true);
check("the shell passes the display name", shell.includes("preferences.profile.displayName || accountName"), true);
check("a signed-in name is the fallback", /displayName \|\| accountName \|\| undefined/.test(shell), true);
check("the profile still takes precedence", shell.indexOf("preferences.profile.displayName ||") < shell.indexOf("accountName || undefined"), true);
check("it waits for Clerk to load", /if \(read\(\)\) return;[\s\S]{0,600}setInterval/.test(shell), true);

/* The current home copy deliberately follows familiar mobile assistant
   phrasing: "Good morning, Name" / "Good afternoon, Name" / "Good evening, Name".
   The first name is used so a long account display name cannot dominate home. */
check("a name yields time-aware first-name copy", /\$\{part\}, \$\{presentName\(firstName\)\}/.test(launch), true);
check("a lowercase handle is capitalised", /function presentName/.test(launch), true);
check("an already-capitalised name is left alone", /\(\^\|\[\\s-\]\)\(\\p\{Ll\}\)/.test(launch), true);
check("the parts are time-of-day", /Good morning|Good afternoon|Good evening/.test(launch), true);
check("no name still gets time-aware copy", launch.includes("return firstName ? `${part}, ${presentName(firstName)}` : part;"), true);
check("there is no placeholder name", /there|friend|user/i.test(launch.slice(launch.indexOf("function greetingForNow"), launch.indexOf("function greetingForNow") + 500)), false);
check("the effect follows the name", launch.includes("}, [name]);"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
