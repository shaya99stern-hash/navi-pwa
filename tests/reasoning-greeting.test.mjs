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

/* ── One left edge, in the greeting and in the header ────────────────────── */

/* Both used to be centred, and both sat above left-aligned content: the
   greeting above the suggestion cards, the header title above the thread. Two
   competing edges on one screen. Reading on a phone starts at the left, so
   that is where both now begin. */
check("the greeting row is left-aligned", /flex w-full items-center justify-center/.test(launch), false);
check("the greeting keeps the spark beside it", /flex items-center gap-3 pl-0\.5/.test(launch), true);
check("the greeting is no longer 2rem", launch.includes("text-[2rem]/[2.375rem]"), false);

/* In flow and left-aligned. The absolute centring it replaced is what forced
   the max width and the spacer: one button on the left against two or three on
   the right means true centre is never the centre of the free space. */
check("the header title sits in the flow", /flex min-w-0 flex-1 flex-col items-start/.test(shell), true);
check("the title is no longer absolutely centred", /absolute bottom-0 left-1\/2 top-\[var\(--safe-top\)\]/.test(shell), false);
check("no spacer is needed any more", shell.includes('<div className="flex-1" aria-hidden="true" />'), false);
check("no width cap is needed any more", /max-w-\[calc\(100%-184px\)\]/.test(shell), false);
/* The thread name is the second line and the only part that can run long, so
   it is the only part that truncates. */
check("the thread label truncates", /max-w-\[200px\] truncate/.test(shell), true);
/* New chat is the outermost trailing button: it is the more destructive of the
   two, so it takes the deliberate position rather than the thumb's. */
check("chat actions come before new chat", shell.indexOf("<Ellipsis") < shell.indexOf("<SquarePen"), true);
check("the shell passes the display name", shell.includes("preferences.profile.displayName || accountName"), true);
/* Someone signed in has already told the app who they are. Making them type it
   again to be greeted by name asks twice for the same thing — so Clerk's name
   is the fallback, and the profile still wins when it is set. */
check("a signed-in name is the fallback", /displayName \|\| accountName \|\| undefined/.test(shell), true);
check("the profile still takes precedence", shell.indexOf("preferences.profile.displayName ||") < shell.indexOf("accountName || undefined"), true);
/* Clerk loads asynchronously and the launch screen is the first thing drawn,
   so a single read runs too early to see a user. The gap is generous because
   what matters is that the early return is followed by a poll, not how much
   comment sits between the two. */
check("it waits for Clerk to load", /if \(read\(\)\) return;[\s\S]{0,600}setInterval/.test(shell), true);
/* A name turns the line into an address, so the bare time-of-day form is the
   only one that reads correctly beside it. The name goes through `presentName`
   because it falls back to the account handle, which is whatever its owner
   typed — "Evening, shaya" reads as a database field rather than an address. */
check("a name yields the plain form", /\$\{part\}, \$\{presentName\(name\)\}/.test(launch), true);
check("a lowercase handle is capitalised", /function presentName/.test(launch), true);
/* Only leading letters, and only where already lowercase: a blanket title-case
   would rewrite "McDonald" and "d'Angelo", which the user typed deliberately. */
check("an already-capitalised name is left alone", /\(\^\|\[\\s-\]\)\(\\p\{Ll\}\)/.test(launch), true);
check("the parts are time-of-day", /Late night|Morning|Afternoon|Evening/.test(launch), true);
// With no name the rotation stands; a placeholder is worse than the variety.
check("no name keeps the rotation", launch.includes("setGreeting(greetingForNow(new Date()))"), true);
check("there is no placeholder name", /there|friend|user/i.test(launch.slice(launch.indexOf("if (name)"), launch.indexOf("if (name)") + 400)), false);
check("the effect follows the name", launch.includes("}, [name]);"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
