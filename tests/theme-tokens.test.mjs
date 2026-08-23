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
const pageColours = [...css.matchAll(/--bg-page:\s*(#[0-9A-Fa-f]{6});/g)].map((m) => m[1].toUpperCase());
check("both themes define a page colour", pageColours.length, 2);
const [darkPage, lightPage] = pageColours;

const manifest = readFileSync("app/manifest.ts", "utf8");
check("the splash matches the dark page", manifest.includes(`background_color: "${darkPage}"`), true);
check("the manifest theme colour matches it too", manifest.includes(`theme_color: "${darkPage}"`), true);

const layout = readFileSync("app/layout.tsx", "utf8");
check("the dark status bar matches the dark page", layout.includes(`(prefers-color-scheme: dark)", color: "${darkPage}"`), true);
check("the light status bar matches the light page", layout.includes(`(prefers-color-scheme: light)", color: "${lightPage}"`), true);

/* The header sits directly under the status bar, so a different colour there
   is a visible seam whatever the manifest says. */
const shell = stripComments(readFileSync("app/components/app-shell.tsx", "utf8"));
const header = /<header className="navi-header[^"]*"/.exec(shell)?.[0] ?? "";
check("the header is found", header.length > 0, true);
check("the header takes the page colour", header.includes("bg-page"), true);
check("the header paints no literal of its own", /bg-\[#|dark:bg-black/.test(header), false);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
