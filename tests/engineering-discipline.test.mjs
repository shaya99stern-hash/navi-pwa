import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const brief = read("lib/ai/engineering-discipline.ts").body;

/* ── It has to be substantial ────────────────────────────────────────────────
   A short framing sentence is what the Developer panel used to send, and it is
   nowhere near enough to stop a confident model rewriting a file it never
   opened. Every commit here deploys to a phone, so this brief carries real
   weight and must not be quietly trimmed back to a slogan. */

const words = brief.split(/\s+/).filter(Boolean).length;
check("the brief is genuinely detailed", words > 900, true);

/* ── Reading a dictated, informal request ────────────────────────────────── */

check("it expects dictated messages", brief.includes("dictated"), true);
check("it expects transcription errors", brief.includes("homophone errors"), true);
check("it reads for intent, not grammar", brief.includes("Read for intent"), true);
check("it extracts every separate request", brief.includes("Pull out every distinct request"), true);
/* "It really doesn't work" means the last fix missed, not that it needs
   re-explaining — the exact failure this session hit twice on the mic. */
check("repeated reports mean look elsewhere", brief.includes("Look somewhere else"), true);
check("feel complaints are treated as measurable", /Find the\s+mechanism/.test(brief), true);
check("clarifying questions are a last resort", brief.includes("Ask a clarifying question only when"), true);

/* ── Not breaking the app ────────────────────────────────────────────────── */

check("never edit an unread file", brief.includes("Never edit a file you have not read"), true);
check("read the callers too", /read its\s+callers/.test(brief), true);
check("existing comments are treated as spec", brief.includes("that comment is the specification"), true);
check("smallest viable change", brief.includes("Smallest change that fully solves it"), true);
/* The most destructive mistake available: a partial file silently deletes the
   rest, because the tool replaces rather than patches. */
check("the whole file must be sent", brief.includes("Anything you leave out is deleted"), true);
check("style must match", brief.includes("nobody can tell which lines you wrote"), true);
check("no type escapes", brief.includes("no non-null assertion"), true);
check("the edge runtime is called out", brief.includes("no Buffer"), true);
check("protected paths are explained, not routed around", brief.includes("not an obstacle to route around"), true);

/* ── Honesty about the result ────────────────────────────────────────────── */

check("self-review before committing", brief.includes("Would this compile"), true);
check("uncertainty means do not commit", /offer the change\s+without committing it/.test(brief), true);
check("no invented commits", /you do not\s+have success/.test(brief), true);
check("results are explained in plain language", brief.includes("a non-programmer follows"), true);

/* ── Loaded only when it can be acted on ─────────────────────────────────── */

const route = read("app/api/chat/route.ts").body;
check("the brief is gated on the commit tool", route.includes('needsEngineeringDiscipline(toolNames.includes("commit_own_source"))'), true);

/* The Developer panel's framing can stay short precisely because the brief
   carries the weight — but it must still tell NaviSoul to read first. */
const panel = read("app/settings/Developer/page.tsx").body;
check("the panel asks it to read first", panel.includes("Find and read the real files first"), true);
check("the panel offers a no-commit path", panel.includes("show me the change instead of committing it"), true);
check("the panel posts to the parameter /new reads", panel.includes("/new?text="), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
