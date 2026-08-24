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

/* The redesign made Code a destination in the sidebar rather than a dial in the
   composer, and gave the header the mode's name as a *fallback* — shown only
   when the conversation has no name of its own. That answers the original
   complaint in a different way than the dial did: the header no longer
   relabels an existing thread, because a named conversation always wins.

   So the durable property is asserted, not the arrangement: whatever the header
   shows, a conversation with a name shows that name. */

check("a named conversation always wins the header",
  /activeChat\?\.title && activeChat\.title !== "New chat" \? activeChat\.title/.test(shell), true);
/* An affordance that opens nothing is worse than no affordance, so the chevron
   only appears where a menu actually exists. */
check("the chevron appears only where it opens something",
  /view === "chat" && messages\.length > 0 && <ChevronDown/.test(shell), true);
check("and the menu only opens when there is a conversation to act on",
  /if \(messages\.length > 0 && activeChat\) setChatMenuOpen\(true\)/.test(shell), true);

/* ── The mode is where the other per-message dials are ────────────────────── */

check("the composer takes the mode", /codeMode: boolean;/.test(composer), true);
check("and the shell hands it over", /codeMode=\{preferences\.mode === "code"\}/.test(shell), true);
check("with a toggle to change it", /onToggleCode=\{toggleCodeMode\}/.test(shell), true);

/* Two states, so a toggle rather than a picker — and the app already treats
   Chat as the unnamed default, showing a mode in the status line only when it
   is Code. */
check("there are exactly two modes to switch between", NAVI_MODES.length, 2);
/* Code moved out of the composer and into the sidebar. What must stay true is
   that it is reachable and that reaching it does not throw away the thread —
   the complaint that started this work was a mode switch that relabelled a
   conversation it had never applied to. */
check("code mode is reachable", /updatePreferences\(\{ \.\.\.preferences, mode: "code" \}\)/.test(shell), true);
check("and switching it never clears the conversation",
  /setMessages\(\[\]\)/.test(shell.slice(shell.indexOf("function toggleCodeMode"), shell.indexOf("function toggleCodeMode") + 400)), false);
/* Research stayed in the composer and must keep working there — this file
   caught it arriving as a prop with nothing calling it. */
/* By its label rather than the shape of its aria expression — that expression
   now also carries whether a search provider exists, and pinning it here made
   an unrelated honesty fix fail a check about *placement*. */
check("research is still a switch in the composer",
  /role="switch"[\s\S]{0,400}aria-checked=\{[^}]*\bresearch\b[^}]*\}/.test(composer), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
