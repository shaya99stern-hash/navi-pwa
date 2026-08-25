import { readFileSync } from "node:fs";
import { stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/**
 * Sans chrome, serif prose — and never the other way round.
 *
 * One rule set `body { font-family: ... serif !important }` 660 lines after
 * `body` had already been given the UI stack. Because `button, input,
 * textarea, select { font: inherit }`, it reached every control: the header
 * title, every Settings row, the composer, the drawer, the placeholders. The
 * measured computed style on the shipped build was `"Source Serif 4", ui-serif,
 * Georgia, ... serif` on `body`, on the composer textarea and on the header.
 *
 * It also made Settings → General → "Chat font: System" a no-op, since that
 * control works by *removing* `.navi-chat-serif` from prose the rule had
 * already made serif regardless.
 *
 * Serif is for prose, through `.navi-chat-serif`, and nowhere else.
 */
const css = stripComments(readFileSync("app/globals.css", "utf8"));

/* Every `body { ... }` block in the file, so a serif declaration cannot come
   back in a second one further down. */
const bodyBlocks = [...css.matchAll(/(^|\})\s*body\s*\{([^}]*)\}/g)].map((match) => match[2]);
check("there is a body rule to check", bodyBlocks.length > 0, true);

for (const [index, block] of bodyBlocks.entries()) {
  const font = /font-family\s*:([^;]*)/.exec(block)?.[1] ?? "";
  if (!font) continue;
  /* The generic family a stack falls back to, which is what decides how the
     chrome reads when nothing above it resolves. `sans-serif` is the answer;
     a bare `serif` is the bug. */
  const families = font.replace(/!important/, "").split(",").map((family) => family.trim().replace(/^["']|["']$/g, ""));
  check(`body rule ${index + 1} falls back to sans`, families.at(-1), "sans-serif");
  check(`body rule ${index + 1} does not use the display face`, font.includes("--font-display"), false);
  check(`body rule ${index + 1} is not !important`, block.includes("!important"), false);
}

/* The prose opt-in still exists — the fix is to scope serif, not to remove it. */
check("prose can still be serif", css.includes(".navi-chat-serif"), true);
check("the prose rule uses the display face", /\.navi-chat-serif[^{]*\{[^}]*--font-display/.test(css), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
