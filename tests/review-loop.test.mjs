import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const architect = read("lib/ai/architect.ts").body;
const route = read("app/api/chat/route.ts").body;

/* ── A correction is not exempt from review ───────────────────────────────
   The single pass shipped its own revision unchecked: the one output nobody
   had verified was the one produced by the step whose entire job is
   verification. A correction is written under more pressure than the original,
   against a constraint list, by a model that cannot run the code either — it
   is not obviously safer than what it replaced. */

check("a loop exists", /export async function reviewUntilSound/.test(architect), true);
check("the route uses the loop, not the single pass",
  /const review = await reviewUntilSound\(/.test(route), true);
check("the single pass is no longer called directly from the route",
  /await reviewDraft\(/.test(route), false);
check("a revision is fed back in", /current = review\.text;/.test(architect), true);
check("the final text is whatever survived the loop", /const finalText = review\.text;/.test(route), true);

/* ── Bounded, because the third round is waiting, not accuracy ─────────── */

check("rounds are capped", /const MAX_REVIEW_ROUNDS = 2;/.test(architect), true);
check("the cap is enforced", /round < MAX_REVIEW_ROUNDS/.test(architect), true);
/* pass and skipped both terminate: only "revised" is worth another look. */
check("agreement ends the loop",
  /review\.verdict === "pass" \|\| review\.verdict === "skipped"\) break;/.test(architect), true);

/* ── Each round asks someone new ─────────────────────────────────────────
   Asking the model that just wrote a correction to check that correction
   reproduces the blind spot the second opinion existed to break. */
check("the reviewer changes per round", /reviewers\[Math\.min\(options\.pass \?\? 0/.test(architect), true);
check("the round is passed down", /pass: round/.test(architect), true);

/* ── The budget is real, and shared across rounds ───────────────────────── */

check("time spent is carried between rounds", /spent \+= Date\.now\(\) - startedAt;/.test(architect), true);
check("a round that cannot finish is not started", /if \(remaining < 4_000\) break;/.test(architect), true);
/* A verification step that cannot run is never a reason to withhold an
   answer — the best draft so far always ships. */
check("the best draft survives every failure path", /return \{ text: current, rounds: completed/.test(architect), true);

/* The user should see that a second look is happening, not a frozen screen. */
check("each round is reported", /onPass\?\.\(round \+ 1\)/.test(architect), true);
check("the second round says so", /Re-checking the correction \(pass \$\{round\}\)/.test(route), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
