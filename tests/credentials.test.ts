import { CREDENTIALS, credentialAdvice, credentialNames, deliberateCredentialNames, hasCredential, readCredential } from "@/lib/ai/credentials";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const NAMES = ["GITHUB_PAT", "NAVI_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "NAVI_VERCEL_TOKEN", "VERCEL_API_TOKEN", "VERCEL_TOKEN"];
const saved = new Map(NAMES.map((name) => [name, process.env[name]]));
const clear = () => NAMES.forEach((name) => { delete process.env[name]; });
const restore = () => saved.forEach((value, name) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
});

/* ── The failure this module was written for ─────────────────────────────────
   Four modules resolved the GitHub token and no two read the same variables.
   A deployment with only `GITHUB_PAT` set — the name the Settings screen offers
   first, and the only one the service catalogue knew — was reported as
   connected, could commit to its own source, and had no repository read tools
   at all, because the resolver gating those never looked at that variable.

   Nothing about that is visible from inside. Every module behaved exactly as
   written; they simply disagreed, and the disagreement reached the user as an
   assistant describing its own capabilities incorrectly. */

clear();
process.env.GITHUB_PAT = "pat-value";
check("the name the app tells people to set is the one it reads", readCredential("github"), "pat-value");
check("and it counts as configured", hasCredential("github"), true);
/* This is the exact combination that used to give reads and reporting different
   answers. It is the regression test for the whole module. */
check("GITHUB_PAT satisfies a read", Boolean(readCredential("github")), true);
check("and satisfies a write, because a person set it", Boolean(readCredential("github", { deliberate: true })), true);

clear();
process.env.GH_TOKEN = "gh-value";
check("a conventional name is still a token for reads", readCredential("github"), "gh-value");
/* The consequence of unifying, caught rather than discovered: `GITHUB_TOKEN`
   and `GH_TOKEN` are injected by CI platforms and agent runtimes — both were
   already set in this project's own build environment, by no person. Reading a
   repository with a platform-supplied token is unremarkable. Committing to this
   app's own source with one is not: nobody granted that, and the first anyone
   would know about it is a commit. */
check("but not consent to write with", readCredential("github", { deliberate: true }), undefined);

clear();
process.env.GITHUB_TOKEN = "ambient-value";
check("the other ambient name behaves the same for reads", readCredential("github"), "ambient-value");
check("and the same for writes", readCredential("github", { deliberate: true }), undefined);

clear();
process.env.GITHUB_TOKEN = "ambient-value";
process.env.NAVI_GITHUB_TOKEN = "chosen-value";
check("a deliberate name is found past an ambient one",
  readCredential("github", { deliberate: true }), "chosen-value");
/* Precedence only matters when two are set, and it must be the list's order
   rather than whichever happened to be checked first. */
clear();
process.env.GITHUB_PAT = "first";
process.env.NAVI_GITHUB_TOKEN = "second";
check("precedence is the order the list gives", readCredential("github"), "first");

clear();
check("nothing set is undefined, not an empty string", readCredential("github"), undefined);
check("and is not configured", hasCredential("github"), false);
/* An empty variable is how a deleted secret looks in a deployment: present,
   blank, and indistinguishable from set unless it is trimmed. */
process.env.GITHUB_PAT = "   ";
check("a blank variable does not count as set", readCredential("github"), undefined);
process.env.GITHUB_PAT = "  padded  ";
check("and a padded one is trimmed", readCredential("github"), "padded");

clear();
process.env.VERCEL_TOKEN = "v";
check("vercel resolves across its names too", readCredential("vercel"), "v");
/* Nothing injects these, so there is no ambient split to make. */
check("and has no ambient names to exclude", deliberateCredentialNames("vercel"), [...credentialNames("vercel")]);

restore();

/* ── The lists themselves ────────────────────────────────────────────────── */

check("every ambient name is one of the accepted names",
  (Object.keys(CREDENTIALS) as Array<keyof typeof CREDENTIALS>)
    .every((id) => CREDENTIALS[id].ambient.every((name) => (CREDENTIALS[id].names as readonly string[]).includes(name))),
  true);
/* A credential whose every name is ambient could never be written with, which
   would be a silently dead capability rather than a safe one. */
check("no credential is entirely ambient",
  (Object.keys(CREDENTIALS) as Array<keyof typeof CREDENTIALS>).every((id) => deliberateCredentialNames(id).length > 0),
  true);
check("no name is listed twice",
  (Object.keys(CREDENTIALS) as Array<keyof typeof CREDENTIALS>)
    .every((id) => new Set(CREDENTIALS[id].names).size === CREDENTIALS[id].names.length),
  true);

/* Advice names the preferred variable first and admits the rest exist. Telling
   someone to add `GITHUB_PAT` when they already have `GITHUB_TOKEN` set sends
   them to configure a capability they already have. */
check("advice leads with the preferred name", credentialAdvice("github").startsWith("GITHUB_PAT"), true);
check("and admits the others are read", credentialAdvice("github").includes("all of which are read"), true);
check("naming every one of them",
  credentialNames("github").every((name) => credentialAdvice("github").includes(name)), true);

/* ── One resolver, read from the source ──────────────────────────────────────
   The point of the module is that nothing resolves these names on its own. A
   module that goes back to reading `process.env.GITHUB_TOKEN` directly
   reintroduces the disagreement without changing any behaviour visible here. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

for (const file of [
  "lib/ai/dev-tools.ts",
  "lib/ai/self-update-tools.ts",
  "lib/github/oauth.ts",
  "lib/ai/diagnostic-tools.ts",
  "app/api/commit/route.ts",
  "app/api/connectors/verify/route.ts"
]) {
  const source = read(file);
  check(`${file} resolves through the shared list`, /readCredential\(/.test(source), true);
  check(`and reads no GitHub variable directly`, /process\.env\.(GITHUB_PAT|NAVI_GITHUB_TOKEN|GITHUB_TOKEN|GH_TOKEN)/.test(source), false);
}

/* The catalogue's alias table is what `inspect_environment` reports from. It
   was the second copy of the list, and the copy that disagreed. */
const catalog = read("lib/ai/provider-catalog.ts");
check("the catalogue derives its aliases rather than restating them",
  /credentialNames\("github"\)/.test(catalog), true);

/* Committing to our own source is the one capability that must not widen when
   a platform hands over a token. */
check("self-update asks for a deliberate name",
  /readCredential\("github", \{ deliberate: true \}\)/.test(read("lib/ai/self-update-tools.ts")), true);
/* And repository reads must not narrow, or the original bug returns inverted. */
check("repository reads take any name",
  /readCredential\("github"\);/.test(read("lib/github/oauth.ts")), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
