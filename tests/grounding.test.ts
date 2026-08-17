import { readFileSync } from "node:fs";
import { join } from "node:path";
import { citedUrls, critiqueAllowed, groundingFor, skipReason } from "@/lib/ai/grounding";
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
/* The gate widened from "lane 3 only" to "anything but the fast lane", and it
   was held back twice before that. The objection was spending a second call on
   turns that currently skip one with no measurement behind the trade. What
   answered it: the call is free-tier, so the cost is latency and quota rather
   than money — and the turns this newly covers are research turns, lane 2 with
   fetched pages, which is exactly where an unchecked answer does the most harm.
   A fabricated citation is indistinguishable from a real one until someone
   follows it. */
for (const lane of [2, 3, 4]) {
  check(`lane ${lane} earns a critique when there is something to check`,
    critiqueAllowed({ lane, grounding: files }), true);
}

/* Lane 1's entire promise is speed, and a second round trip is the one thing
   it cannot afford. This is the line that must not drift. */
check("the fast lane never earns one", critiqueAllowed({ lane: 1, grounding: files }), false);
/* Grounding is still required at every lane: a reviewer with nothing to check
   against re-reads the draft, agrees with it, and bills a round trip for a
   reworded version. */
check("and no lane earns one without grounding",
  [1, 2, 3, 4].some((lane) => critiqueAllowed({ lane, grounding: none })), false);

check("the skip reason names the lane",
  skipReason({ lane: 1, grounding: files }), "lane 1 is the fast lane and cannot afford a second round trip");
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
check("a one-step plan is not shown as a checklist", route.includes("plan.steps.length > 1"), true);
/* The card renders `steps`, never `constraints`. The latter also carries this
   app's fixed build rules — that it is a mobile PWA, that touch targets are
   44px — which are instructions to a model, not a plan. On screen they told
   someone who asked to list their repositories that the reply would be
   deployable to Vercel as-is. */
check("the card is not fed the build rules", /data: \{ summary: plan\.summary, steps: plan\.constraints/.test(route), false);
check("the card is fed the planner's own steps", /steps: plan\.steps\.map/.test(route), true);
/* The writer still receives all of them; only the screen is filtered. */
check("the writer still gets every constraint", route.includes("constraints: constraintBlock(plan)"), true);
/* "0 of 4" on a plan that has not started reads as a stall, not as progress. */
check("progress appears only once there is some", card.includes("done > 0"), true);

/* ── Pages read this turn are grounding too ─────────────────────────────────
   Before this there were two grounding kinds and both needed a repository, so
   a research turn — the entire point of a fetcher — could never be checked
   against anything. Worse, nothing connected the URLs in an answer to the URLs
   actually retrieved, which made a real citation and an invented one identical
   from the app's side. An invented citation is the failure that makes a
   research answer worse than no answer, because it looks verified. */

const page = { url: "https://county.example.gov/rates", text: "The 2026 rate is $68.40 per unit." };

/* Attributions are compared as a set rather than probed with
   `material.includes(url)`. Substring-matching a URL passes on a mangled
   address or on one turning up for any unrelated reason, and CodeQL flags the
   shape on sight because the same expression used for an authorisation
   decision is a genuine vulnerability. Comparing the extracted set is both
   stronger and unambiguous: these addresses, exactly, in this order. */
const attributions = (material: string): string[] =>
  [...material.matchAll(/^--- Retrieved from (\S+) ---$/gm)].map((match) => match[1]);

const sourced = groundingFor({ sources: [page] });
check("a fetched page grounds the turn", sourced.kind, "sources");
check("its content becomes the material", sourced.material.includes("$68.40"), true);
check("attributed to where it came from", attributions(sourced.material), ["https://county.example.gov/rates"]);
/* The half that is the point: an answer may only cite what was really read. */
check("the critique is told to check citations against what was retrieved",
  /citation|cites/i.test(sourced.instruction), true);
check("and to treat an unsupported specific as unsupported",
  /number|date|name|rate/i.test(sourced.instruction), true);

/* Ranked below files on purpose: a repository file is what this app holds, a
   fetched page is somebody else's claim, and a confident page is still a claim. */
check("execution still outranks a fetched page",
  groundingFor({ executionOutput: "exit 1: boom", sources: [page] }).kind, "execution");
check("files still outrank a fetched page",
  groundingFor({ retrieved: "export function x() {}", sources: [page] }).kind, "files");

check("no sources is still no grounding", groundingFor({ sources: [] }).kind, "none");
/* A failed fetch must never become material an answer is checked against — it
   would be checking a claim against an error message. */
check("a source with no text is ignored",
  groundingFor({ sources: [{ url: "https://x.example", text: "   " }] }).kind, "none");
check("a source with no url is ignored",
  groundingFor({ sources: [{ url: "", text: "real content here" }] }).kind, "none");

/* Several pages are one body of material, each labelled with its address. */
const many = groundingFor({ sources: [page, { url: "https://other.example/a", text: "Second page." }] });
check("every retrieved page appears", many.material.includes("Second page."), true);
check("each with its own address, in the order they were read",
  attributions(many.material), ["https://county.example.gov/rates", "https://other.example/a"]);
check("and the instruction is plural when there are several", /pages below were/.test(many.instruction), true);
check("singular when there is one", /page below was/.test(sourced.instruction), true);

/* A fetched page unlocks the critique on the lane that already earns one. The
   lane gate itself is deliberately unchanged until there is a baseline to
   measure a wider one against. */
check("a research turn on lane 3 can now be critiqued",
  critiqueAllowed({ lane: 3, grounding: sourced }), true);
check("a fast lane still is not, grounding or no grounding",
  critiqueAllowed({ lane: 1, grounding: sourced }), false);

check("cited urls are extracted from an answer",
  citedUrls("See https://a.example/one and https://b.example/two for detail."),
  ["https://a.example/one", "https://b.example/two"]);
/* A URL at the end of a sentence carries the full stop into the match, and a
   comparison against what was fetched would then miss every one of them. */
check("trailing sentence punctuation is not part of the url",
  citedUrls("Confirmed at https://a.example/one."), ["https://a.example/one"]);
check("the same url cited twice is one url",
  citedUrls("https://a.example/x and again https://a.example/x").length, 1);
check("an answer citing nothing yields nothing", citedUrls("No links here at all."), []);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
