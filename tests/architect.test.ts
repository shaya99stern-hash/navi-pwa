import { heuristicPlan, shouldConsultArchitect, constraintBlock, withoutReviewPreamble } from "@/lib/ai/architect";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};
const P = (text: string, o: Partial<Parameters<typeof heuristicPlan>[0]> = {}) => heuristicPlan({
  text, hasFiles: false, imageRequested: false, audioRequested: false,
  tools: { web: true, code: false, artifacts: true }, effort: "medium", ...o
});

// Lanes.
check("code request → code", P("my typescript build fails").lane, "code");
check("repo talk → code", P("check the CI on my repository").lane, "code");
check("research → research", P("what is the latest news on rates").lane, "research");
check("design question → reasoning", P("compare the trade-offs of these two approaches").lane, "reasoning");
check("chat → general", P("tell me a story about a fox").lane, "general");
check("image short-circuits", P("anything", { imageRequested: true }).lane, "image");
check("audio short-circuits", P("anything", { audioRequested: true }).lane, "audio");

// Code beats research on a tie — the goal is a fix, not a citation.
check("code wins the tie", P("look up why my npm build is failing").lane, "code");
// Research needs the toggle actually on.
check("research needs web on", P("what is the latest news", { tools: { web: false, code: false, artifacts: true } }).lane, "general");

// The QA gate is scoped to code, and off at Low.
check("code at medium is reviewed", P("fix my react component").needsReview, true);
check("code at low is not reviewed", P("fix my react component", { effort: "low" }).needsReview, false);
check("prose is never reviewed", P("write me a poem").needsReview, false);

// PWA constraints ride along with every code answer.
const codePlan = P("write me a react component");
check("code carries PWA constraints", codePlan.constraints.some((c) => c.includes("mobile PWA")), true);
check("constraint block is stated as requirements", constraintBlock(codePlan).includes("requirements, not suggestions"), true);
check("chat carries no constraints", constraintBlock(P("hello there friend")), "");

// The architect is consulted only when it can help and is worth the latency.
check("media never consults", shouldConsultArchitect({ text: "make a picture of a dog now", plan: P("x", { imageRequested: true }), effort: "high" }), false);
check("low effort never consults", shouldConsultArchitect({ text: "compare these two frameworks for me", plan: P("compare these two frameworks for me"), effort: "low" }), false);
check("short message never consults", shouldConsultArchitect({ text: "hi", plan: P("hi"), effort: "high" }), false);
check("unmatched request does consult", shouldConsultArchitect({ text: "help me figure out what to do about the thing", plan: P("help me figure out what to do about the thing"), effort: "medium" }), true);
check("high effort consults", shouldConsultArchitect({ text: "compare these two frameworks for me", plan: P("compare these two frameworks for me"), effort: "high" }), true);
check("clear code at medium skips the hop", shouldConsultArchitect({ text: "fix my typescript build error", plan: P("fix my typescript build error"), effort: "medium" }), false);

/* ── The reviewer is given a role, not just an instruction to review ────────
   A generalist told to "review this answer" checks whether it reads well —
   the one property a draft almost always has, since it was written by a model
   optimising for exactly that. A reviewer given a role checks what that role
   knows goes wrong. The role comes from the plan's own lane, so it invents no
   new signal and cannot disagree with the routing.

   Read from source: the role text reaches the model through the system prompt
   at the `generateText` call, which cannot be exercised here without spending
   a real provider request. */
const architectSource = (require("node:fs") as typeof import("node:fs")).readFileSync(
  (require("node:path") as typeof import("node:path")).join(process.cwd(), "lib/ai/architect.ts"), "utf8"
);

check("the reviewer's role is derived from the plan's lane",
  /reviewerRole\(plan\.lane\)/.test(architectSource), true);
/* Added to the generic checks rather than replacing them: a reviewer that only
   looks where its role points misses the part that was simply never written. */
check("and is appended to the general checks, not swapped for them",
  /\$\{REVIEWER_SYSTEM\}\\n\\n\$\{reviewerRole/.test(architectSource), true);

/* The research role carries the assertion that matters most for a system that
   fetches pages: an invented citation is worse than a missing one, because it
   makes an unchecked claim look verified. */
check("the research reviewer is told to trace every specific claim to a source",
  /appears in no retrieved source is unsupported/.test(architectSource), true);
check("and to treat a citation to something unread as the most serious error",
  /citation to something that was not read/.test(architectSource), true);

/* The code role points at lifecycle and state bugs specifically — the class
   this session kept finding by hand, and the class a style-focused review
   never surfaces. */
check("the code reviewer is pointed at the unhappy paths",
  /empty input, a failed request, a missing field/.test(architectSource), true);
check("and at two mechanisms tracking one piece of state",
  /two mechanisms tracking the same state/.test(architectSource), true);

check("the reasoning reviewer recomputes rather than trusts",
  /Recompute the arithmetic rather than trusting it/.test(architectSource), true);
check("every lane has a role, including the general one",
  /Review this as the person who asked/.test(architectSource), true);

/* The property that makes a second call worth making at all: the reviewer runs
   on a different provider from the writer. Two models sharing weights share
   their blind spots, and a draft's author is the worst judge of it. */
check("the reviewer pool is other providers, indexed by round",
  /reviewers\[Math\.min\(options\.pass \?\? 0, reviewers\.length - 1\)\]/.test(architectSource), true);

/* ── Which kinds of work earn the pass ──────────────────────────────────────
   Two gates gnard this: `plan.needsReview && critiqueAllowed(...)`. Widening
   only the second achieved nothing, because `needsReview` was written twice —
   once in each plan builder — and both said code-only. That is the shape of
   bug this whole session kept finding in other places. */

check("code still earns a review", P("my typescript build fails").needsReview, true);
/* The case the widening was for: this app fetches pages now, and a fabricated
   citation is indistinguishable from a real one until somebody follows it. */
check("research earns one too", P("what is the latest news on rates").needsReview, true);
check("and reasoning, where a confident wrong number is the failure mode",
  P("compare the trade-offs of these two approaches").needsReview, true);
/* Prose comes back reworded rather than corrected, at the cost of a round
   trip; low effort is a promise about speed. */
check("prose does not", P("tell me a story about a fox").needsReview, false);
check("nor does anything at low effort",
  P("my typescript build fails", { effort: "low" }).needsReview, false);
check("nor an image request",
  P("draw me a poster", { imageRequested: true }).needsReview, false);

/* One helper, called by both plan builders, so the next widening cannot land
   in one and miss the other. */
check("both plan builders ask the same function",
  (architectSource.match(/needsReview: worthReviewing\(/g) ?? []).length, 2);

/* ── A revision must not announce itself ────────────────────────────────────
   Whatever `reviewDraft` returns as a revision replaces the user's answer
   verbatim. The system prompt forbids a preamble; weak models write one
   anyway, and "Here is the corrected version:" was shipping as the first line
   the user read — announcing a review they are not supposed to detect. */

check("a bare announcement line is removed",
  withoutReviewPreamble("Here is the corrected version:\nThe rate is 4.2 percent."),
  "The rate is 4.2 percent.");
check("so is one without a colon",
  withoutReviewPreamble("Revised answer\nThe rate is 4.2 percent."),
  "The rate is 4.2 percent.");
check("and one phrased as a sentence",
  withoutReviewPreamble("This is the updated answer.\nThe rate is 4.2 percent."),
  "The rate is 4.2 percent.");
/* The line this must not cross: an answer that legitimately opens by talking
   about a correction keeps its first line. This strips a label, not a
   paragraph. */
check("a real opening sentence is kept",
  withoutReviewPreamble("The corrected filing deadline matters here because the county rejects late submissions outright, so the whole schedule shifts.\nMore detail follows."),
  "The corrected filing deadline matters here because the county rejects late submissions outright, so the whole schedule shifts.\nMore detail follows.");
check("an answer with no preamble is untouched",
  withoutReviewPreamble("The rate is 4.2 percent."), "The rate is 4.2 percent.");

/* ── PASS is a verdict wherever it appears in a short reply ─────────────────
   Anchoring it to the first character read "Looks correct. PASS" as a
   correction and replaced a sound answer with the reviewer's commentary. The
   mission loop's checker had the same bug and the same fix. */
check("the verdict match is not anchored to the start",
  /\/\\bPASS\\b\/i\.test\(text\)/.test(architectSource), true);
check("and is bounded by length, so a long reply mentioning PASS is not a verdict",
  /text\.length < 400/.test(architectSource), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
