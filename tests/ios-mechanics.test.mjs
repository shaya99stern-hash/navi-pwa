import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
/* Comments are stripped before any assertion that checks for the *absence* of
   something. A comment explaining why a property is deliberately missing
   contains the property name, and matching that reports it as present — which
   is how an assertion passes or fails for entirely the wrong reason. */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const layout = stripComments(readFileSync(join(root, "app/layout.tsx"), "utf8"));
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const metrics = readFileSync(join(root, "app/components/viewport-metrics.tsx"), "utf8");
const settings = readFileSync(join(root, "app/components/settings-sheet.tsx"), "utf8");

/* ── 9a. The keyboard on Android ─────────────────────────────────────────── */

check("the layout viewport resizes for the keyboard", layout.includes('interactiveWidget: "resizes-content"'), true);
check("the viewport still covers the safe area", layout.includes('viewportFit: "cover"'), true);
/* iOS ignores both, and they break pinch-zoom for low-vision users. The 16px
   floor is the real zoom fix, so these must stay absent. */
check("pinch-zoom is not disabled", /maximum-?[Ss]cale|userScalable/.test(layout), false);

/* ── 9b. The 16px floor is the keyboard jump ─────────────────────────────── */

/* iOS zooms the page when a focused field computes below 16px and unzooms on
   blur. That scaling is the jump — not the inset arithmetic, which is correct.
   Floored globally so a new field cannot reintroduce it at its call site. */
check("fields are floored at 16px", css.includes(":is(input, textarea, select, [contenteditable=\"true\"])"), true);
check("the floor uses max, not a fixed size", css.includes("font-size: max(16px, 1em)"), true);
// max() rather than a flat 16px preserves Dynamic Type scaling above the floor.
check("dynamic type still scales", /max\(16px, 1em\)/.test(css), true);
/* Checkboxes and radios carry no text; the floor would only inflate the box. */
check("checkboxes are exempt", css.includes(':is(input[type="checkbox"], input[type="radio"])'), true);
/* :is() ties with a Tailwind text-[…] utility on specificity and wins on
   source order, so it has to come after the utilities layer. */
check("the floor comes after tailwind utilities", css.lastIndexOf("@tailwind utilities") < css.indexOf("font-size: max(16px, 1em)"), true);

/* ── 9c. The header drifting out of view ─────────────────────────────────── */

/* iOS scrolls the *layout* viewport to reveal a focused field even though body
   is fixed, sliding the pinned header away. The shell is positioned from
   visualViewport, so that scroll is pure drift. */
check("the layout viewport is pinned", metrics.includes("const pinLayoutViewport"), true);
check("it only acts when there is drift", metrics.includes("window.scrollX !== 0 || window.scrollY !== 0"), true);
check("it runs after the keyboard state is written", metrics.indexOf('root.dataset.keyboardOpen') < metrics.indexOf("pinLayoutViewport();"), true);
/* WebKit re-scrolls partway through the keyboard's ~250ms animation, so one
   pass lands before the drift it is meant to undo. */
check("a later pass covers the animation", metrics.includes("window.setTimeout(pinLayoutViewport, 320)"), true);
check("scroll is listened for", metrics.includes('window.addEventListener("scroll", pinLayoutViewport'), true);
check("and removed in the same teardown", metrics.includes('window.removeEventListener("scroll", pinLayoutViewport)'), true);
/* The existing visualViewport tracking is correct and subtle — it deliberately
   ignores URL-bar collapse when deciding whether a keyboard is open. */
check("keyboard detection is untouched", metrics.includes("hasTextInput && keyboardInset > 80"), true);

/* ── The slash rows read as one slash ────────────────────────────────────── */

/* Every value in data/skills.json already carries its leading slash, so the
   template added a second one and rows read `//change-case` while the help
   text said to type `/`. */
check("the row does not add a second slash", /\{skill\.triggers\.slash\}/.test(settings), true);
check("the literal prefix is gone", settings.includes(">/{skill.triggers.slash}"), false);

const skills = JSON.parse(readFileSync(join(root, "data/skills.json"), "utf8"));
check("the data carries the slash", skills.every((s) => s.triggers.slash.startsWith("/")), true);
check("and never doubles it", skills.every((s) => !s.triggers.slash.startsWith("//")), true);

/* ── A tap that lands late reads as a tap that was missed ────────────────── */

/* `touch-action: manipulation` removes iOS Safari's 300ms wait for a possible
   double-tap-to-zoom. Without it a control responds a third of a second late,
   which nobody experiences as slowness — they experience it as the first tap
   not working, and tap again. That is "sometimes I have to double click".
   
   Selecting on the tag alone missed anything tappable that is not a `button`:
   the Test controls in the Integrations sheet are `<span role="button">`
   because they sit inside a row that is itself a button, and nesting buttons
   is invalid HTML. Correct markup that silently opted them out of the fix. */
check("tags carry the fast-tap rule", /\bbutton,\s*\n\s*a,\s*\n\s*label,/.test(css), true);
check("so do elements that only have the role", /\[role="button"\],/.test(css), true);
check("switches too", /\[role="switch"\],/.test(css), true);
check("the rule is manipulation, not none", /touch-action: manipulation;/.test(css), true);

/* Every tappable thing that is not a real button should be caught by the role
   selectors above. A new one using a role this rule does not list is the
   regression. */
const COVERED = new Set(["button", "switch", "radio", "tab", "option"]);
const roles = [...readFileSync(join(root, "app/components/integrations-sheet.tsx"), "utf8")
  .matchAll(/role="(\w+)"[\s\S]{0,200}?onClick/g)].map((m) => m[1]);
check("every clickable role in the sheet is covered", roles.filter((r) => !COVERED.has(r)), []);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
