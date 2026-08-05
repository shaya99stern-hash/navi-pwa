import { readFileSync } from "node:fs";
import { join } from "node:path";
import { critiqueAllowed, groundingFor, skipReason } from "@/lib/ai/grounding";
import { planFor } from "@/app/components/plan-card";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── A critique with nothing to check against is worse than none ─────────────
   Asked to "review your answer" with no external material, a model re-reads
   its own reasoning, finds it agreeable — it wrote it — and returns a reworded
   version at the cost of a full round trip. That spends the budget *and* adds
   a step where an error can be introduced. */

check("nothing means nothing", groundingFor({}).kind, "none");
check("empty strings mean nothing", groundingFor({ retrieved: "  ", executionOutput: "" }).kind, "none");
check("no material when ungrounded", groundingFor({}).material, "");

check("file contents are grounding", groundingFor({ retrieved: "--- src/x.ts ---\nexport const a = 1;" }).kind, "files");
check("execution output is grounding", groundingFor({ executionOutput: "The code failed.\n\nError: boom" }).kind, "execution");

/* Execution beats files because a run is a fact and a file is evidence. If the
   draft says the function returns 42 and the run says it threw, that is
   settled without any judgement at all. */
check("execution outranks files", groundingFor({ retrieved: "files here", executionOutput: "ran here" }).kind, "execution");

check("the execution instruction names the run", /actually run/.test(groundingFor({ executionOutput: "x" }).instruction), true);
check("it prioritises a failed run presented as working", /presents the code as working/.test(groundingFor({ executionOutput: "x" }).instruction), true);
check("the file instruction names the repository", /repository actually holds/.test(groundingFor({ retrieved: "x" }).instruction), true);

// Material is bounded, or the check costs more budget than it is worth.
const huge = groundingFor({ executionOutput: "x".repeat(50_000) });
check("material is truncated", huge.material.length < 21_000, true);
check("truncation is stated", huge.material.endsWith("truncated."), true);

/* ── Both conditions are required ────────────────────────────────────────── */

const files = groundingFor({ retrieved: "some file" });
const none = groundingFor({});

check("lane 3 with grounding runs", critiqueAllowed({ lane: 3, grounding: files }), true);
check("lane 3 without grounding does not", critiqueAllowed({ lane: 3, grounding: none }), false);
// Spending a second round trip on a fast follow-up is the latency being fought.
for (const lane of [1, 2, 4]) {
  check(`lane ${lane} does not earn a critique`, critiqueAllowed({ lane, grounding: files }), false);
}

check("the skip reason names the lane", skipReason({ lane: 1, grounding: files }), "lane 1 does not earn a critique pass");
check("the skip reason names the gap", skipReason({ lane: 3, grounding: none }), "nothing real to check the draft against");

/* ── The plan is visible before the work, not after ──────────────────────── */

const message = {
  id: "m1",
  role: "assistant" as const,
  parts: [
    { type: "text", text: "answer" },
    { type: "data-plan", data: { summary: "Fix the inset", steps: [{ text: "Read the composer", done: true }, { text: "Apply the safe area", done: false }] } }
  ]
} as never;

const plan = planFor(message);
check("a plan is read off the message", plan?.steps.length, 2);
check("the summary comes through", plan?.summary, "Fix the inset");
check("completion is tracked per step", plan?.steps[0].done, true);

// Steps may arrive as plain strings; they are still steps.
const stringSteps = planFor({ id: "m", role: "assistant", parts: [{ type: "data-plan", data: { steps: ["one", "two"] } }] } as never);
check("string steps are accepted", stringSteps?.steps.map((s) => s.text), ["one", "two"]);
check("string steps start unfinished", stringSteps?.steps.every((s) => !s.done), true);

check("a message with no plan yields null", planFor({ id: "m", role: "assistant", parts: [{ type: "text", text: "hi" }] } as never), null);
check("an empty step list is not a plan", planFor({ id: "m", role: "assistant", parts: [{ type: "data-plan", data: { steps: [] } }] } as never), null);
check("blank steps are dropped", planFor({ id: "m", role: "assistant", parts: [{ type: "data-plan", data: { steps: ["  ", "real"] } }] } as never)?.steps.length, 1);

/* ── Read against the source ─────────────────────────────────────────────── */

const root = process.cwd();
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const card = readFileSync(join(root, "app/components/plan-card.tsx"), "utf8");

check("the route gates the critique on grounding", route.includes("critiqueAllowed({ lane, grounding })"), true);
check("a skipped pass is logged, not silent", route.includes("skipped the critique pass"), true);
/* The plan is emitted before the answer streams, which is the whole point —
   after the fact it is a description rather than something correctable. */
/* Compared against the status line in the *same* dispatch path. An earlier
   `stage: "stream"` belongs to the image branch, which never emits a plan —
   comparing against that one passed for the wrong reason. */
const planAt = route.indexOf('type: "data-plan"');
const streamAt = route.indexOf('Building the interactive artifact.');
check("the plan is emitted before the answer streams", planAt > -1 && planAt < streamAt, true);
check("the plan precedes the model call", planAt < route.indexOf("const result = streamText({"), true);
check("a one-step plan is not shown as a checklist", route.includes("plan.constraints.length > 1"), true);
/* "0 of 4" on a plan that has not started reads as a stall, not as progress. */
check("progress appears only once there is some", card.includes("done > 0"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
