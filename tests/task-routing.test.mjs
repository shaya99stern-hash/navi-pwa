import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const providers = read("lib/ai/providers.ts").body;
const route = read("app/api/chat/route.ts").body;
const architect = read("lib/ai/architect.ts").body;

/* ── Kind of work, not amount of it ───────────────────────────────────────
   The lane table routes by difficulty, which is right for most decisions and
   wrong for a few. Mechanical work arriving at high effort was the clearest
   waste: reshaping text has one right answer, so reasoning depth buys nothing
   and — on the metered lane — the frontier route could be billed for it. */

check("work is classified by kind", /export function classifyTask/.test(providers), true);
check("the route classifies from the request", /taskKind: classifyTask\(lastUserText\)/.test(route), true);
check("mechanical work takes the fast route", /taskKind === "mechanical" && !hasFiles/.test(providers), true);
/* It sits with the capability checks, not inside the lane switch: it is the
   same kind of rule — a property of the work outranking the difficulty guess. */
const mechanicalAt = providers.indexOf('taskKind === "mechanical"');
const laneOneAt = providers.indexOf("if (lane === 1)");
check("it is decided before the lane", mechanicalAt > 0 && mechanicalAt < laneOneAt, true);
/* Attachments are a hard constraint and outrank the optimisation — a fast
   text model cannot read an image. */
check("attachments still win", /taskKind === "mechanical" && !hasFiles/.test(providers), true);

/* Narrow on purpose. Misclassifying reasoning as mechanical sends real work to
   a shallow model, which is far worse than missing an optimisation — so the
   verb must lead, which a question almost never does. */
check("the pattern is anchored to a leading verb", /const MECHANICAL = \/\^/.test(providers), true);
check("conversion is anchored too", /const CONVERSION = \/\^/.test(providers), true);

/* ── The planner names what will go wrong ────────────────────────────────
   The plan said what to do and what to satisfy, never what would probably
   break — so the reviewer rediscovered it every time. A reviewer pointed at a
   specific boundary finds the defect; one told "look for errors" does not. */

check("plans carry risks", /risks: string\[\]/.test(architect), true);
check("the planner is asked for them", /each one a specific way this particular answer is likely to be wrong/.test(architect), true);
check("generic caution is refused", /"check for errors" is not/.test(architect), true);
check("they are capped at three", /parsed\.risks[\s\S]{0,200}\.slice\(0, 3\)/.test(architect), true);
/* The heuristic plan has no model behind it, so it has no opinion. A guessed
   risk points the reviewer at the wrong place — worse than not directing it. */
check("the heuristic plan claims none", /risks: \[\],/.test(architect), true);
/* Naming them is only worth anything if the reviewer receives them. */
check("the reviewer is given them first", /Most likely failures in this particular answer — check these first/.test(architect), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
