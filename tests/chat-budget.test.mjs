import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/**
 * The budgets that answer a turn, and the one relationship between them that
 * has to hold.
 *
 * `timeout.totalMs` on the answering `streamText` is merged into that call's
 * abort signal, so it bounds the whole multi-step loop — every tool step and
 * every retry sleep — rather than one HTTP request. It was a literal 50s
 * inside a function declaring `maxDuration = 300` and a request budget of
 * 240s. That produced `TimeoutError: The operation was aborted due to timeout`
 * as half of all production errors, and it made retry impossible: the SDK
 * honours `retry-after` below a minute, the provider returns up to 52s, and a
 * 52s sleep cannot finish inside a 50s budget.
 *
 * Nothing failed when those three numbers disagreed, which is why they drifted.
 * These assertions are the thing that notices.
 */
const source = readFileSync("app/api/chat/route.ts", "utf8");

const number = (name) => {
  const match = new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(source);
  return match ? Number(match[1].replaceAll("_", "")) : null;
};

const maxDuration = number("export const maxDuration");
const requestBudget = number("const REQUEST_BUDGET_MS");
const streamReserve = number("const STREAM_DELIVERY_RESERVE_MS");
const minStreamBudget = number("const MIN_STREAM_BUDGET_MS");

check("maxDuration is declared", typeof maxDuration, "number");
check("the request budget is declared", typeof requestBudget, "number");
check("the stream reserve is declared", typeof streamReserve, "number");
check("the stream floor is declared", typeof minStreamBudget, "number");

/* The longest `retry-after` the AI SDK will sleep on rather than ignore. A
   stream budget under this can never complete an honoured backoff, so every
   rate limit becomes a timeout instead. */
const LONGEST_HONOURED_BACKOFF_MS = 60_000;

check("the request budget stays under maxDuration", requestBudget < maxDuration * 1000, true);
check("the stream floor clears the longest honoured backoff", minStreamBudget > LONGEST_HONOURED_BACKOFF_MS, true);
check("the stream floor fits inside the request budget", minStreamBudget + streamReserve < requestBudget, true);

/* And the literal is gone: the budget must be derived from what the request
   has left, not pinned to a constant that cannot see the clock. */
check("the stream budget is derived, not a literal", /totalMs:\s*\d/.test(source), false);
check("the stream budget reads the request clock", source.includes("REQUEST_BUDGET_MS - (Date.now() - requestStartedAt)"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
