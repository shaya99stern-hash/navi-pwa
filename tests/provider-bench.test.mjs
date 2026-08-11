import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const bench = read("evals/providers.ts").body;

/* ── It measures models, not the app ──────────────────────────────────────
   The question is which provider is better at what, so the app's own routing
   is the one variable that must be held still. Going through /api/chat would
   measure the router — the thing the results are meant to inform. */
check("providers are called directly", /\$\{base\}\/chat\/completions/.test(bench), true);
check("it does not route through the app", /\/api\/chat/.test(bench), false);
/* Benchmarking a model the app never uses answers a question nobody asked. */
check("it benchmarks the routes actually used", /const BENCH_ROUTES/.test(bench), true);
check("temperature is pinned", /temperature: 0/.test(bench), true);

/* ── Every task has a checkable answer ────────────────────────────────────
   The moment scoring needs an opinion, the benchmark measures the grader. */
const kinds = [...bench.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]);
const expects = [...bench.matchAll(/expect: \{ type: "(contains|regex|includes-all)"/g)].map((m) => m[1]);
const prompts = [...bench.matchAll(/^\s{4}prompt:/gm)].length;
check("every task carries an expectation", expects.length, prompts);
check("no task is graded by judgement", expects.every((t) => ["contains", "regex", "includes-all"].includes(t)), true);
/* A capability with one task is an anecdote. */
check("at least five capabilities are covered", new Set(kinds).size >= 5, true);
check("each task says why it discriminates", [...bench.matchAll(/^\s{4}why:/gm)].length, prompts);

/* ── It refuses to mislead ────────────────────────────────────────────────
   A provider scoring zero because its key is rejected is a configuration
   problem, not a capability finding. Reporting the two identically is exactly
   how a benchmark produces a confident wrong conclusion. */
check("errors are separated from capability findings",
  /not capability findings/.test(bench), true);
check("an unconfigured provider is skipped, not scored zero", /skipped\.push/.test(bench), true);
check("one provider is refused as a comparison",
  /a benchmark of one provider cannot compare anything/.test(bench), true);
/* A single run per task is a sample of one, and moving a routing rule on that
   is how an invented number gets laundered into a measured one. */
check("the sample-size caveat is stated", /use --runs 3 or more before moving a routing rule/.test(bench), true);
check("repeat runs are supported", /--runs/.test(bench), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
