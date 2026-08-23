import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attributedError, describeAttemptFailure, failureFacts, type AttemptFacts } from "@/lib/ai/attempt-failure";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── 56% of production errors could not be attributed ────────────────────────
   An external audit of seven days found 1,961 error occurrences, of which 1,093
   carried no provider, no model and no status code — `TimeoutError` and
   `AI_NoOutputGeneratedError` arriving as a bare stack frame. Every diagnosable
   error in the dataset lived in the remaining 44%.

   The cause was structural, not careless: a failed attempt is *ordinary* here.
   The route tries each engine in turn, the user should never hear about it, and
   only the last failure was ever thrown — stripped of everything identifying
   which of four attempts produced it. The failover is right. What was missing
   is that silent-to-the-user was also silent to us, and the log is not the
   user. */

const facts: AttemptFacts = {
  provider: "cerebras", model: "llama-3.3-70b", engine: "Navi Deep",
  lane: 3, dispatch: "chat", attempt: 2, of: 4, startedAt: Date.now() - 1_200
};

/* ── Digging the status out of whatever shape arrived ──────────────────────── */

check("a plain status is found", failureFacts({ statusCode: 403 }).status, 403);
/* Providers disagree about `status` versus `statusCode`, and the SDK wraps some
   failures while passing others through. A reader that checks one place finds
   nothing most of the time — which is indistinguishable from nothing to find. */
check("and so is the other spelling", failureFacts({ status: 429 }).status, 429);
check("a wrapped error keeps its useful half",
  failureFacts(Object.assign(new Error("outer"), { cause: { statusCode: 402 } })).status, 402);
check("the name survives wrapping",
  failureFacts(Object.assign(new Error("x"), { name: "AI_APICallError" })).name, "AI_APICallError");
/* A value that is not an HTTP status must not be reported as one. */
check("a non-status code is not mistaken for one", failureFacts({ code: "ECONNRESET" }).status, null);
check("nor is one out of range", failureFacts({ status: 99 }).status, null);
check("a cycle terminates", failureFacts((() => {
  const loop: Record<string, unknown> = { name: "Loop" };
  loop.cause = loop;
  return loop;
})()).name, "Loop");
check("and nothing at all is still answerable", failureFacts(null).status, null);

/* ── The line a person reads a week later ─────────────────────────────────── */

const line = describeAttemptFailure(facts, Object.assign(new Error("Forbidden"), { name: "AI_APICallError", statusCode: 403 }));
for (const field of ["engine=Navi Deep", "provider=cerebras", "model=llama-3.3-70b", "lane=3", "attempt 2/4", "status=403"]) {
  check(`the log line carries ${field}`, line.includes(field), true);
}
check("and how long it ran before failing", /elapsedMs=\d+/.test(line), true);
/* "Cerebras is failing" and "Cerebras returns 403 with an HTML body" are the
   same sentence to a counter and different problems to a person. */
check("a missing status says so rather than being omitted",
  describeAttemptFailure(facts, new Error("timeout")).includes("status=none"), true);

/* ── The error that finally surfaces ──────────────────────────────────────── */

const surfaced = attributedError(facts, Object.assign(new Error("Forbidden"), { statusCode: 403 }));
check("it names the engine", surfaced.message.includes("Navi Deep"), true);
check("and the model", surfaced.message.includes("llama-3.3-70b"), true);
check("and which attempt it was", surfaced.message.includes("attempt 2/4"), true);
/* The stack is still the fastest way to the line that threw. Losing it to gain
   a label would trade one blindness for another. */
check("the original is kept as the cause", (surfaced.cause as Error).message, "Forbidden");
check("and it is identifiable as ours", surfaced.name, "NaviAttemptError");

/* ── The production wiring ───────────────────────────────────────────────── */

const route = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
check("the facts are fixed once per attempt, before it runs",
  /const facts: AttemptFacts = \{/.test(route), true);
check("every failed attempt is logged, not only the last",
  /console\.warn\(describeAttemptFailure\(facts, error\)\)/.test(route), true);
/* Four exits record a failure: the draft throwing, the draft coming back
   empty, the stream committing nothing, and the outer catch. Three of them
   attached nothing at all, and the empty-draft one did not even name itself. */
const attributed = (route.match(/lastFailure = failedWith\(/g) ?? []).length;
check("all four exits that record a failure attribute it", attributed, 4);
check("with none left assigning a bare error",
  /lastFailure = error;|lastFailure = failure \?\?/.test(route), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
