import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/**
 * The app had two colour schemes and one palette.
 *
 * Seventy-four elements were painted `#0A84FF` — iOS system blue — with
 * another thirty-seven on the matching red, green and orange. All four are
 * *dark mode* system colours, hard-coded. A light theme existed, was
 * switchable, and could never take effect on any of them: the toggles, the
 * Done buttons, the checkmarks and the destructive rows stayed dark-mode blue
 * and dark-mode red on an ivory background.
 *
 * The tokens to use were already defined and already mapped in the Tailwind
 * config. Nothing was missing. The literals simply sat next to them.
 *
 * These assertions are the thing that was absent: not a token, but anything
 * that notices a literal coming back.
 */

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const sources = walk("app").filter((path) => path.endsWith(".tsx") || path.endsWith(".ts"));
check("there are components to check", sources.length > 0, true);

/* The four iOS system colours that have a token, by the class shape Tailwind
   reads: an arbitrary hex in a utility. A hex inside an artifact template or a
   sanitizer test is not a painted element and is not what this is about. */
const BANNED = {
  "#0A84FF": "accent",
  "#FF453A": "danger",
  "#34C759": "success",
  "#FF9F0A": "warning",
  "#FF9500": "warning"
};
for (const [literal, token] of Object.entries(BANNED)) {
  const offenders = sources.filter((path) => stripComments(readFileSync(path, "utf8")).includes(`-[${literal}]`));
  check(`${literal} is spelled ${token}`, offenders, []);
}

/* ---- The trap underneath the sweep ------------------------------------ */

/**
 * Tailwind 3 can only apply an opacity modifier to a colour it can decompose
 * into channels. Point the theme at a `var()` holding a hex and `bg-accent/10`
 * compiles to *nothing* — no warning, no error, no rule. Six elements in this
 * app use exactly that shape, and they would simply have lost their
 * background: a failure with no symptom until someone looked at the screen.
 *
 * So the accent is defined in channels, and `--accent-primary` is derived from
 * them rather than written twice. Two spellings of one colour is how this
 * class of bug starts.
 */
const config = readFileSync("tailwind.config.js", "utf8");
check("the accent takes an alpha value", config.includes("rgb(var(--accent-primary-rgb) / <alpha-value>)"), true);

const css = readFileSync("app/globals.css", "utf8");
const channelDefs = [...css.matchAll(/--accent-primary-rgb:\s*([\d\s]+);/g)].map((m) => m[1].trim());
/* One per theme. A theme that defines the hex but not the channels would take
   the *other* theme's accent everywhere an opacity modifier is used. */
check("both themes define the channels", channelDefs.length, 2);
check("the channels are space-separated triples", channelDefs.every((value) => /^\d{1,3} \d{1,3} \d{1,3}$/.test(value)), true);
check("the two themes differ", new Set(channelDefs).size, 2);

const derived = [...css.matchAll(/--accent-primary:\s*([^;]+);/g)].map((m) => m[1].trim());
check("every accent is derived from its channels", derived, ["rgb(var(--accent-primary-rgb))", "rgb(var(--accent-primary-rgb))"]);

/* Colours built from the accent are derived too, or they drift the moment the
   accent is retuned — which is precisely what happened to the literals above. */
check("no rgba copy of the dark accent survives", css.includes("rgba(217, 119, 87"), false);
check("no rgba copy of the light accent survives", css.includes("rgba(193, 95, 60"), false);

/* ---- One colour at launch ---------------------------------------------- */

/**
 * On an installed iPhone the app used to open through three different greys:
 * the manifest splash at #262624, the header at black, and the page at
 * #121214. Each was a defensible value on its own, and in sequence they read
 * as the app stuttering on launch.
 *
 * A manifest cannot be theme-aware, so the dark page colour is the one it
 * takes — that is what the app opens as. The other two follow it.
 */
/* Read from the channels, because that is where the value now lives — the
   page colour is derived so `bg-page/95` can exist. Comparing the hex the
   manifest hardcodes against the channels the app paints is the whole point:
   two spellings of one colour is exactly how they drift apart. */
const toHex = (channels) => `#${channels.trim().split(/\s+/).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const pageChannels = [...css.matchAll(/--bg-page-rgb:\s*([\d\s]+);/g)].map((m) => m[1]);
check("both themes define a page colour", pageChannels.length, 2);
const [darkPage, lightPage] = pageChannels.map(toHex);

const manifest = readFileSync("app/manifest.ts", "utf8");
check("the splash matches the dark page", manifest.includes(`background_color: "${darkPage}"`), true);
check("the manifest theme colour matches it too", manifest.includes(`theme_color: "${darkPage}"`), true);

const layout = readFileSync("app/layout.tsx", "utf8");
check("the dark status bar matches the dark page", layout.includes(`(prefers-color-scheme: dark)", color: "${darkPage}"`), true);
check("the light status bar matches the light page", layout.includes(`(prefers-color-scheme: light)", color: "${lightPage}"`), true);

/* The header sits directly under the status bar, so a different colour there
   is a visible seam whatever the manifest says. */
const shell = stripComments(readFileSync("app/components/app-shell.tsx", "utf8"));
const header = /<header\s+[\s\S]{0,500}?className="navi-header[^"]*"/.exec(shell)?.[0] ?? "";
check("the header is found", header.length > 0, true);
check("the header takes the page colour", header.includes("bg-page"), true);
check("the header paints no literal of its own", /bg-\[#|dark:bg-black/.test(header), false);

/* ---- The reload loop ---------------------------------------------------- */

/**
 * Roughly thirty reloads of /new in seven seconds, on an installed phone, with
 * the status bar strobing.
 *
 * The server renders the theme from a cookie, so the first paint is already
 * right. The effect that keeps the theme in sync ran before storage had been
 * read back, compared that correct paint against the *default* preference,
 * found a difference, overwrote the cookie and reloaded. The reload rendered
 * the default, storage hydrated, the real preference disagreed, and it
 * reloaded again — flipping between the two forever.
 *
 * Every other persistence effect in the shell already waits for `hydrated`.
 * This one reloads the page, so it is the one where the omission could not
 * stay quiet.
 */
const shellSource = readFileSync("app/components/app-shell.tsx", "utf8");
const themeEffect = /useEffect\(\(\) => \{[\s\S]*?resolvedTheme\(preferences\.theme\)[\s\S]*?\}, \[[^\]]*\]\);/.exec(shellSource)?.[0] ?? "";
check("the theme effect is found", themeEffect.length > 0, true);
check("it waits for storage before doing anything", themeEffect.includes("if (!hydrated) return;"), true);
check("and re-runs once storage arrives", /\}, \[hydrated, preferences\.theme\]\);$/.test(themeEffect.trim()), true);
/* The reload itself stays — iOS bakes the status-bar style in at load from a
   server-rendered meta tag, so an installed app cannot follow a theme change
   without one. Once, on a real change. */
check("a real theme change still reloads", /if \(changed && standaloneDisplay\(\)\) window\.location\.reload\(\);/.test(themeEffect), true);
check("and only when something actually changed", /const changed = document\.documentElement\.dataset\.theme !== next;/.test(themeEffect), true);

/* ---- Classes that compile to nothing ------------------------------------ */

/**
 * Tailwind drops a class naming a colour the theme does not define. Silently:
 * no warning, no error, no rule in the stylesheet, and the element simply does
 * not get the style. Twice now:
 *
 *   - `bg-accent/10` against a `var()` holding a hex — six elements that would
 *     have lost their background.
 *   - `active:bg-elev-4` on four buttons, against an elevation step that was
 *     never defined. Those press states did not render at all.
 *
 * Neither looks like a bug in the source. Both read as perfectly ordinary
 * Tailwind. So the check is mechanical: every colour a class names must exist
 * in the config, and every colour used with an opacity modifier must be
 * defined in channels, or the modifier is thrown away.
 */
const colorBlock = /colors:\s*\{([\s\S]*?)\n {6}\}/.exec(config)?.[1] ?? "";
check("the colour block is found", colorBlock.length > 0, true);
const defined = new Set([...colorBlock.matchAll(/^\s*"?([\w-]+)"?:/gm)].map((m) => m[1]));

/* Tailwind's own palette and the non-colour words that share these prefixes
   (`border-t`, `rounded-b`, `shadow-menu`, `bg-gradient-to-b`). Only names the
   theme is expected to own reach the assertion. */
const NOT_OURS = /^(white|black|transparent|current|inherit|none|auto|red|blue|green|yellow|amber|orange|purple|pink|gray|grey|slate|zinc|neutral|stone|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)(-\d{2,3})?$|^(left|right|top|bottom|center|start|end|clip|ellipsis|nowrap|wrap|balance|pretty|solid|dashed|dotted|double|hidden|menu|sheet|dock|composer|card|gradient-to-[a-z]{1,2}|opacity-\d+|[btlrxy]|[btlrxy]-\d+|xs|sm|md|lg|xl|\d?xl|\d+)$/;
const CLASS = /(?<![\w-])(?:[a-z-]+:)*(bg|text|border|ring|fill|stroke|divide|outline|placeholder|caret|from|to|via)-([a-z][a-z0-9-]*)(\/\d+)?(?![\w[-])/g;

const undefinedColours = [];
const alphaOnOpaque = [];
for (const path of sources.filter((p) => p.endsWith(".tsx"))) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(CLASS)) {
    const [, , name, alpha] = match;
    if (NOT_OURS.test(name)) continue;
    if (!defined.has(name)) { undefinedColours.push(`${path}: ${match[0]}`); continue; }
    /* An opacity modifier on a colour the config spells as a bare `var()`
       produces no rule at all. */
    if (alpha && !new RegExp(`"?${name}"?:\\s*"rgb\\(var`).test(colorBlock)) {
      alphaOnOpaque.push(`${path}: ${match[0]}`);
    }
  }
}
check("every colour class names a colour that exists", [...new Set(undefinedColours)], []);
check("every opacity modifier is on a colour that can take one", [...new Set(alphaOnOpaque)], []);

/* The step four buttons reach for on press, specifically. */
check("the fourth elevation exists", defined.has("elev-4"), true);
check("both themes define it", (css.match(/--bg-elev-4:/g) ?? []).length, 2);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
