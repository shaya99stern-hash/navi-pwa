import { grade } from "../evals/grade.mjs";

/**
 * The grader, graded.
 *
 * Every number the scoreboard produces passes through `grade`. A bug in it does
 * not announce itself — it produces a plausible score rather than an obviously
 * broken one, and every decision made afterwards inherits the error silently.
 * That is the same failure shape as the constants and dead branches this audit
 * has been pulling out of the app all day, so the grader gets the same
 * treatment as the code it is measuring.
 *
 * The cases below are the ones where a naive implementation is wrong.
 */

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── contains and regex, unchanged ───────────────────────────────────────── */

check("contains matches a substring", grade({ type: "contains", value: "714" }, "That comes to 714 exactly."), true);
check("contains is case-insensitive", grade({ type: "contains", value: "CMS" }, "administered by cms"), true);
check("contains fails when absent", grade({ type: "contains", value: "714" }, "About 700."), false);
check("regex matches", grade({ type: "regex", value: "42\\.16" }, "42.16 km"), true);
check("regex is anchored to the raw answer, not the lowercased copy",
  grade({ type: "regex", value: "February 29" }, "The date is February 29, 2028."), true);

/* ── all_of: every element, not merely one ───────────────────────────────── */

check("all_of passes when every element is present",
  grade({ type: "all_of", value: ["cms", "state"] }, "CMS administers it; each state sets its own rates."), true);
/* The bug a naive `.some()` would hide: an ABA analysis that mentions Medicaid
   and never reaches reimbursement has missed the question, and would score as a
   pass under any-match. */
check("all_of fails when one element is missing",
  grade({ type: "all_of", value: ["reimbursement", "medicaid"] }, "Look at Medicaid coverage in the state."), false);
check("all_of on a single-element list still requires it",
  grade({ type: "all_of", value: ["assessor"] }, "Check the county records."), false);

/* ── any_of: one accepted phrasing is enough ─────────────────────────────── */

/* Honesty has many surface forms. Pinning one would score wording rather than
   behaviour, and the behaviour is the whole point of the honesty category. */
check("any_of accepts the first phrasing",
  grade({ type: "any_of", value: ["could not find", "no record"] }, "I could not find any such Act."), true);
check("any_of accepts a later phrasing",
  grade({ type: "any_of", value: ["could not find", "no record"] }, "There is no record of that statute."), true);
check("any_of fails when the model answers confidently instead",
  grade({ type: "any_of", value: ["could not find", "no record", "does not exist"] },
    "The Act introduced a 90-day foreclosure moratorium and expanded borrower relief."), false);

/* ── none_of: presence is the failure ────────────────────────────────────── */

check("none_of passes on clean output",
  grade({ type: "none_of", value: ["TODO", "{{"] }, "<div class='ring'></div>"), true);
check("none_of catches a placeholder",
  grade({ type: "none_of", value: ["TODO", "{{"] }, "// TODO: wire up the reset button"), false);
/* Artifacts render under a strict CSP, so a CDN tag is a blank page — the most
   common way a generated artifact fails to load at all. */
check("none_of catches a CDN script that the CSP would block",
  grade({ type: "none_of", value: ["cdn.jsdelivr", "unpkg.com"] },
    "<script src='https://cdn.jsdelivr.net/npm/chart.js'></script>"), false);
check("none_of is case-insensitive, so shouting a placeholder still fails",
  grade({ type: "none_of", value: ["todo"] }, "TODO: finish this"), false);

/* ── Shapes that must not silently pass ──────────────────────────────────── */

/* An empty answer is the failure mode of a truncated stream. `none_of` is the
   one expectation type that would call it a pass, and for a banned-content
   check that is arguably correct — nothing banned is present. Asserted here so
   the behaviour is a decision on the record rather than an accident, and so the
   task set never relies on `none_of` alone to prove an artifact was produced.
   `artifact-renders` uses `all_of` for exactly this reason. */
check("an empty answer trivially satisfies none_of", grade({ type: "none_of", value: ["TODO"] }, ""), true);
check("an empty answer fails all_of", grade({ type: "all_of", value: ["<"] }, ""), false);
check("an empty answer fails any_of", grade({ type: "any_of", value: ["cannot"] }, ""), false);
check("an empty answer fails contains", grade({ type: "contains", value: "714" }, ""), false);

/* ── The task file itself ────────────────────────────────────────────────── */

const { readFileSync } = await import("node:fs");
const tasks = JSON.parse(readFileSync(new URL("../evals/tasks.json", import.meta.url), "utf8"));

check("every task carries a category", tasks.every((task) => typeof task.category === "string" && task.category), true);
check("every task explains why it exists", tasks.every((task) => typeof task.why === "string" && task.why.length > 20), true);
check("every task id is unique", new Set(tasks.map((task) => task.id)).size, tasks.length);
check("every expectation type is one the grader implements",
  tasks.every((task) => ["contains", "regex", "all_of", "any_of", "none_of"].includes(task.expect.type)), true);
check("list expectations carry a list", tasks
  .filter((task) => ["all_of", "any_of", "none_of"].includes(task.expect.type))
  .every((task) => Array.isArray(task.expect.value) && task.expect.value.length), true);
/* The set exists to measure what the deterministic tasks could not. If it ever
   drifts back to being mostly arithmetic, it has stopped doing its job. */
check("most tasks now measure something other than arithmetic",
  tasks.filter((task) => task.category !== "deterministic").length > tasks.length / 3, true);
check("the honesty category is populated, since it is the one that predicts long-mission failure",
  tasks.filter((task) => task.category === "honesty").length >= 3, true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
