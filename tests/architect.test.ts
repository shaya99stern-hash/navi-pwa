import { heuristicPlan, shouldConsultArchitect, constraintBlock } from "@/lib/ai/architect";

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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
