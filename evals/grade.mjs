/**
 * How one answer is scored.
 *
 * Its own module so it can be tested. A grader nobody checks is worse than no
 * scoreboard: a silent bug in here does not produce an obviously wrong number,
 * it produces a plausible one, and every decision made afterwards inherits it.
 * `tests/eval-grader.test.mjs` runs the cases below.
 *
 * `contains` and `regex` were enough while every task had one computable right
 * answer — 17% of 4200 is 714 and nothing else. The tasks that matter now do
 * not work that way: "does this expansion analysis reach payer economics" and
 * "did it refuse to invent a statute that does not exist" are not string
 * equality, and pretending otherwise is how a scoreboard ends up measuring only
 * what was already easy to measure.
 *
 * Deliberately mechanical, with no model in the loop. A model grading a model
 * is a second model that can be wrong, in correlated ways, and it cannot run
 * without spending the free-tier quota the whole app exists to conserve. These
 * check for the presence or absence of load-bearing *elements*. That is coarse.
 * Coarse and trustworthy beats fine and unfalsifiable.
 */

/** True when the answer satisfies the task's expectation. */
export function grade(expect, answer) {
  const { type, value } = expect;
  const haystack = String(answer).toLowerCase();
  const has = (needle) => haystack.includes(String(needle).toLowerCase());

  if (type === "regex") return new RegExp(value, "i").test(String(answer));
  /* Every element required: a multi-part analysis that omits one part has
     missed the question, however well it covers the rest. */
  if (type === "all_of") return value.every(has);
  /* One of several phrasings. Honesty has many surface forms, and pinning a
     single one would score wording rather than behaviour. */
  if (type === "any_of") return value.some(has);
  /* Presence is the failure: placeholders, CDN tags, invented confidence. */
  if (type === "none_of") return !value.some(has);
  return has(value);
}

/** What the task wanted, for the line printed under a failure. */
export function describeExpectation(expect) {
  return `${expect.type} ${JSON.stringify(expect.value)}`;
}
