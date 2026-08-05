import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectRepo, rankFiles, scorePath } from "@/lib/ai/repo-retrieval";
import { terms } from "@/lib/memory";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Only retrieve when the repository is unambiguous ────────────────────────
   Guessing a repository and silently loading the wrong codebase is far worse
   than not guessing: the read tools still work, and the model asks for what it
   needs. A slower honest path beats a fast confident wrong one. */

check("a github url names the repo", detectRepo("look at https://github.com/acme/widgets please"), { owner: "acme", repo: "widgets" });
check("a .git suffix is stripped", detectRepo("https://github.com/acme/widgets.git"), { owner: "acme", repo: "widgets" });
check("a bare owner/repo works", detectRepo("check acme/widgets for the bug"), { owner: "acme", repo: "widgets" });
check("a repo at the end of a sentence works", detectRepo("what is in acme/widgets?"), { owner: "acme", repo: "widgets" });

// Things that look like a repo and are not.
check("a file path is not a repo", detectRepo("open src/index.ts"), null);
check("a date is not a repo", detectRepo("on 12/2026 we shipped"), null);
check("prose alone is not a repo", detectRepo("why is the composer broken"), null);
check("a fraction is not a repo", detectRepo("about 3/4 of the time"), null);

/* ── The filename is the author's own summary of the file ────────────────── */

const query = terms("fix the composer inset on ios");

check("an exact filename match scores highest",
  scorePath("app/components/composer-dock.tsx", query) > scorePath("app/components/message-row.tsx", query), true);
check("a path mention beats nothing",
  scorePath("app/components/composer-dock.tsx", query) > 0, true);
check("an unrelated file scores nothing", scorePath("lib/audio/player.ts", terms("database migration")), 0);
check("an empty query scores nothing", scorePath("anything.ts", []), 0);

/* A test file is rarely the thing being asked about; it is a description of
   the thing. Nudged down rather than excluded, since sometimes it is the ask. */
check("tests rank below the code they test",
  scorePath("tests/composer.test.ts", query) < scorePath("app/components/composer-dock.tsx", query), true);

/* ── Precision over recall ───────────────────────────────────────────────── */

const tree = [
  "app/components/composer-dock.tsx",
  "app/components/composer-menu.tsx",
  "app/components/message-row.tsx",
  "app/globals.css",
  "lib/ai/providers.ts",
  "lib/audio/player.ts",
  "tests/composer.test.ts",
  "docs/architecture.md",
  ...Array.from({ length: 40 }, (_, index) => `lib/unrelated/module-${index}.ts`)
];

const ranked = rankFiles(tree, "fix the composer inset on ios");
check("at most five files come back", ranked.length <= 5, true);
check("the best match is first", ranked[0]?.path, "app/components/composer-dock.tsx");
check("unrelated files are excluded", ranked.some((entry) => entry.path.startsWith("lib/unrelated/")), false);
check("results are ordered by score", ranked.every((entry, index) => index === 0 || entry.score <= ranked[index - 1].score), true);

/* Irrelevant context does not sit harmlessly in a prompt — it gives the model
   more plausible-looking material to reason from than the question needs. */
check("a query matching nothing retrieves nothing", rankFiles(tree, "quantum chromodynamics").length, 0);
check("an empty query retrieves nothing", rankFiles(tree, "").length, 0);
check("an empty tree retrieves nothing", rankFiles([], "composer").length, 0);

/* ── Read against the source ─────────────────────────────────────────────── */

const root = process.cwd();
const retrieval = readFileSync(join(root, "lib/ai/repo-retrieval.ts"), "utf8");
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const memory = readFileSync(join(root, "lib/memory.ts"), "utf8");

/* One tokenizer. A second written for this file would drift from the first,
   and nobody would notice until the two disagreed. */
check("the tokenizer is reused, not rewritten", retrieval.includes('import { terms } from "../memory"'), true);
check("memory exports it", /export function terms\(/.test(memory), true);
check("retrieval defines no tokenizer of its own", /function terms\(/.test(retrieval.replace(/import .*/g, "")), false);

// The tree is fetched once per repository and cached.
check("the tree is cached", retrieval.includes("readCatalogCache<string[]>(key)"), true);
check("one recursive call, not a directory walk", retrieval.includes("recursive=1"), true);
check("build output is filtered out", /node_modules|\.next/.test(retrieval), true);
check("lockfiles are filtered out", retrieval.includes("LOCKFILE"), true);

/* Placed with the volatile tail. File contents differ on every question, so
   above the stable prefix they would invalidate the metered lane's cached
   prefix on every single turn. */
check("retrieved files sit after the stable prefix", route.indexOf("stablePrefix(") < route.indexOf('retrieved || ""'), true);
check("retrieved files sit after app knowledge", route.indexOf("APP_KNOWLEDGE") < route.indexOf('retrieved || ""'), true);
check("constraints still come last", route.indexOf('retrieved || ""') < route.lastIndexOf('constraints || ""'), true);

// Retrieval is an optimisation on tools that already work.
check("a failure falls back to the tools", route.includes(".catch(() => null)"), true);
check("retrieval only runs in code mode", route.includes('mode === "code" ? detectRepo(lastUserText) : null'), true);
check("the user is told what was read", route.includes("Read ${retrieval.paths.length} file"), true);
check("the model is told to say what it read", retrieval.includes("say in one line which files you read"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
