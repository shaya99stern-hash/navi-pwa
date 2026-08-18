import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAVI_MODES } from "@/lib/chat";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const shell = readFileSync(join(root, "app/components/app-shell.tsx"), "utf8");
const composer = readFileSync(join(root, "app/components/composer-dock.tsx"), "utf8");

/* ── A title is a claim about where you are ──────────────────────────────────
   The mode held the header's dominant line while behaving as a per-message
   routing preference. Switching it changed the title and not the conversation,
   which anywhere else in this app would read as a bug — every other thing that
   appears in that position (Recents, Projects, Artifacts, Settings) is a place,
   and going to it changes what you are looking at.

   And it was worse than odd. The mode is a global preference and the title
   ignored which chat was open, so switching to Code relabelled every earlier
   conversation on sight: a header making a claim about a thread that was never
   true of it. */

check("the header no longer names the mode", /modeTitle/.test(shell), false);
check("it carries the conversation's own name instead",
  /activeChat\?\.title \?\? \(messages\.length \? "New chat" : "NaviOS"\)/.test(shell), true);
/* The chevron promised a menu. On the chat view there is none any more, and an
   affordance that opens nothing is worse than no affordance. */
check("and the chevron appears only where it still opens something",
  /view === "chat" \? null : <ChevronDown/.test(shell), true);
check("the title is inert on the chat view",
  /disabled=\{view === "chat"\}/.test(shell), true);
/* A control that does nothing must not announce itself to a screen reader as
   one that does. */
check("and announces itself as inert too",
  /aria-label=\{view === "chat" \? undefined : "Back to chat"\}/.test(shell), true);

/* ── The mode is where the other per-message dials are ────────────────────── */

check("the composer takes the mode", /codeMode: boolean;/.test(composer), true);
check("and the shell hands it over", /codeMode=\{preferences\.mode === "code"\}/.test(shell), true);
check("with a toggle to change it", /onToggleCode=\{toggleCodeMode\}/.test(shell), true);

/* Two states, so a toggle rather than a picker — and the app already treats
   Chat as the unnamed default, showing a mode in the status line only when it
   is Code. */
check("there are exactly two modes to switch between", NAVI_MODES.length, 2);
check("and the toggle is a switch, like Research beside it",
  /role="switch"\n {16}aria-checked=\{codeMode\}/.test(composer), true);
/* Both are optional, both are labelled, both apply to the next message. An
   unlabelled icon in a row of labelled ones is undiscoverable. */
check("it is labelled rather than icon-only", /<span className=\{`font-semibold \$\{codeMode/.test(composer), true);
check("and says what turning it on is for",
  /Turn it on for software, debugging, and repositories/.test(composer), true);
/* It yields to the microphone alongside the other controls, or the recording
   strip renders at half width beside controls nobody can reach one-handed. */
check("and steps aside while a microphone is open",
  /\{listening \|\| talking \? null : \(\n {14}\/\* Chat is the default/.test(composer), true);

/* The toggle writes the same preference the request body reads, so what the
   switch says and what the turn does cannot disagree. */
check("the toggle writes the mode preference",
  /const next = preferences\.mode === "code" \? "chat" : "code";/.test(shell), true);
check("and the request still carries it", /mode: preferences\.mode,/.test(shell), true);

/* ── The sheet it replaced is gone ───────────────────────────────────────────
   An orphaned component is the thing the next change reaches for. */

check("the mode sheet is deleted", existsSync(join(root, "app/components/mode-sheet.tsx")), false);
check("and nothing imports it", /mode-sheet/.test(shell), false);
check("nor is there a modal left to open", /modeSheetOpen/.test(shell), false);

/* ── What did not change ─────────────────────────────────────────────────────
   Switching the mode has never cleared the conversation and still does not.
   That part was right: routing is chosen per message, so two threads would be a
   wall with nothing behind it, and losing the ability to debug something in
   Code and then ask about it plainly would be a real loss. */

check("switching the mode does not touch the thread",
  /toggleCodeMode\(\) \{[\s\S]{0,200}setMessages/.test(shell), false);

/* ── And the app's description of itself keeps up ───────────────────────────
   This is the second time the mode paragraph has been wrong. It described a
   segmented control at the top of the left side panel, which had not been true
   for some time — the switch was the header chevron. Prose about a moving app
   goes stale, which is the whole reason the screen list and the credential
   names are derived now; this paragraph is prose because where a control sits
   is not something the code states about itself. */

const knowledge = readFileSync(join(root, "lib/ai/app-knowledge.ts"), "utf8");
check("the description no longer names a side-panel control",
  /segmented control at\n {2}the top of the left side panel/.test(knowledge), false);
check("it says where the toggle actually is",
  /Code is a toggle in the composer,\n {2}beside Effort and Research/.test(knowledge), true);
check("and that the header names the conversation",
  /header names the conversation rather than the mode/.test(knowledge), true);
/* The property that has always been true and must stay stated, because it is
   the one someone asks about after switching. */
check("and that switching never clears the conversation",
  /it never clears the open conversation/.test(knowledge), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
