import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(join(root, "lib/skills/instant.ts"), "utf8");

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The doorway, not the library ─────────────────────────────────────────
   All 82 on-device skills already resolved without a provider call. Exactly
   three were reachable from ordinary prose; the other 79 worked perfectly and
   were invisible unless you knew the slash command. The bottleneck was never
   the number of skills, so this pins the width of the way in. */

const routes = [...source.matchAll(/skill:\s*"([a-z-]+\.[a-z0-9-]+)"/g)].map((m) => m[1]);
check("prose reaches more than the original three", routes.length >= 12, true);
check("routes are unique", routes.length, new Set(routes).size);
/* Spread across families, not twelve variations of one. */
check("routes span at least five skill families",
  new Set(routes.map((id) => id.split(".")[0])).size >= 5, true);

/* ── Every pattern is anchored ────────────────────────────────────────────
   A false match is far worse than a miss: it intercepts a real question and
   answers it with a tool. "tell me about base64" must reach the model. So
   every pattern anchors both ends rather than looking for a keyword loosely. */
const patterns = [...source.matchAll(/pattern:\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*)/g)].map((m) => m[1]);
/* `routes` counts every prose-reachable skill: the table plus the three
   bespoke handlers that predate it (arithmetic, unit conversion, today's
   date), which are matched inline rather than through the table. */
check("the table is all pattern-driven", patterns.length >= 12, true);
check("the bespoke handlers still count toward reach", routes.length - patterns.length, 3);
check("every pattern is start-anchored", patterns.every((p) => p.startsWith("/^")), true);
check("every pattern is end-anchored", patterns.every((p) => /\$\/[a-z]*$/.test(p)), true);

/* ── Structured results are rendered, not dropped ─────────────────────────
   `unwrap` accepts only strings, which silently discarded every skill
   returning an object — word count, percentage and base conversion each
   matched, ran correctly, and produced nothing. A route that fires and returns
   null is worse than one that never fires: the work is done and thrown away. */
check("a renderer for structured output exists", /function render\(result: SkillResult\)/.test(source), true);
check("the routes use it", /const text = render\(await route\.run\(match\)\)/.test(source), true);
check("objects render as one line, not fenced JSON", source.includes('pairs.join(" · ")'), true);

/* A pattern that matched but produced nothing must fall through to the model
   rather than reporting an error the user cannot act on. */
check("a fired-but-empty route yields to the model", /return null;\n  \}\n\n  if \(TODAY/.test(source), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
