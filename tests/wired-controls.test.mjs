import { readdirSync, readFileSync, statSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/**
 * A prop that arrives and is used by nothing.
 *
 * This is the defect this app keeps shipping, and it has never once looked
 * like a defect. Nothing throws, nothing renders wrong, the types are correct
 * on both sides, and the caller goes on passing a handler forever. What it
 * costs is a whole feature, silently:
 *
 *   - `research` / `onToggleResearch` — web search became unreachable from
 *     anywhere in the app while the prompt still offered it and the router
 *     still weighed it.
 *   - `memoryStatus.skillNames` / `lessonNames` — fetched every time Settings
 *     opened, rendered nowhere, so everything the app had learned was
 *     invisible.
 *   - `codeMode` / `onToggleCode` — a whole routing lane, its preset and its
 *     prompt, behind a control that existed in no screen.
 *   - `localChatCount` — the "what is stored" screen could say nothing was
 *     stored while the history drawer listed a dozen conversations.
 *
 * Four times. Each found by reading, months apart, and each a feature the
 * owner believed was working. So this stops being something to notice and
 * becomes something that fails.
 *
 * The rule is deliberately narrow: a *destructured* name used nowhere in the
 * function body. That is unambiguous — there is no dynamic access to a name
 * that was destructured out — and it is exactly the shape all four had.
 */

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = `${dir}/${entry}`;
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const components = walk("app").concat(walk("lib")).filter((path) => path.endsWith(".tsx"));
check("there are components to check", components.length > 0, true);

/* `({ a, b }: Props)` opening a function, arrow or otherwise. Anything with a
   type annotation on the destructure is a props bag; a bare destructure inside
   a body is a local and not what this is about. */
const DESTRUCTURE = /(?:function\s+\w+|=>\s*)?\(\{([^}]*)\}\s*:\s*[\w<>,\s|&]+\)\s*(?:=>|\{)/g;

const unused = [];
for (const file of components) {
  const source = readFileSync(file, "utf8");
  let match;
  while ((match = DESTRUCTURE.exec(source))) {
    const names = match[1]
      .split(",")
      .map((entry) => entry.trim().split(/[:=]/)[0].trim())
      .filter((name) => /^\w+$/.test(name));
    /* A single-prop component is usually a tiny wrapper and the pattern below
       produces noise on them; the defect has always been a bag of several. */
    if (names.length < 2) continue;
    const body = source.slice(match.index + match[0].length);
    for (const name of names) {
      if (!new RegExp(`\\b${name}\\b`).test(body)) unused.push(`${file}: ${name}`);
    }
  }
}

/* Empty. Not "small" — empty. Every entry is either a feature nobody can
   reach or an argument nobody needs, and both are worth one line to resolve:
   wire it up, or stop passing it. */
check("every destructured prop is used", unused, []);

/* ---- The four that got here, held open ---------------------------------- */

/* Each of these is a control whose handler had no caller. Asserting the call
   rather than the prop is the point: a prop can be passed to nothing forever,
   but a call site is the feature existing. */
const composer = readFileSync("app/components/composer-dock.tsx", "utf8");
check("research reaches its handler", composer.includes("onToggleResearch()"), true);
check("code mode reaches its handler", composer.includes("onToggleCode()"), true);

const settings = readFileSync("app/components/settings-sheet.tsx", "utf8");
check("learned skills are rendered", settings.includes("memoryStatus.skillNames.join"), true);
check("learned lessons are rendered", settings.includes("memoryStatus.lessonNames.join"), true);
check("the device's own chat count is shown", settings.includes("<Count value={localChatCount} />"), true);
/* And shown whatever the cloud is doing — the regression was that this whole
   section only ever spoke for the mirror. */
check("it is not behind the cloud's state",
  /On this device<\/SectionHeader>[\s\S]{0,600}<Count value=\{localChatCount\} \/>/.test(settings), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
