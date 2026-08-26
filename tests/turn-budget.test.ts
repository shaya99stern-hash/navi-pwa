import { compileTurnBudget, subcallOutputBudget } from "@/lib/ai/navi-soul/turn-budget";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const greeting = compileTurnBudget({
  request: "Hi",
  dispatch: "general",
  effort: "medium",
  style: "balanced",
  artifactRequested: false,
  hasFiles: false,
  planSteps: 1
});
check("greeting is trivial", greeting.class === "trivial");
check("greeting never inherits 8k output", greeting.maxOutputTokens <= 512);
check("greeting exposes no model tools", greeting.maxTools === 0);
check("greeting cannot enter a long tool loop", greeting.maxToolSteps === 1);

const shortHardQuestion = compileTurnBudget({
  request: "Explain quantum entanglement",
  dispatch: "general",
  effort: "medium",
  style: "balanced",
  artifactRequested: false,
  hasFiles: false,
  planSteps: 2
});
check("short substantive question is not mistaken for trivial", shortHardQuestion.class === "standard");
check("standard answer is bounded", shortHardQuestion.maxOutputTokens <= 1_800);
check("standard tool roster is bounded", shortHardQuestion.maxTools <= 6);

const research = compileTurnBudget({
  request: "Research the latest changes and compare the sources",
  dispatch: "research",
  effort: "medium",
  style: "detailed",
  artifactRequested: false,
  hasFiles: false,
  planSteps: 3
});
check("research gets research budget", research.class === "research");
check("research stays below the global 8k ceiling", research.maxOutputTokens < 8_000);
check("research gets enough tool depth without 16-step default", research.maxToolSteps === 8);

const artifact = compileTurnBudget({
  request: "Create an interactive car driving simulation",
  dispatch: "general",
  effort: "medium",
  style: "balanced",
  artifactRequested: true,
  hasFiles: false,
  planSteps: 3
});
check("artifact is output-heavy even when the sentence is short", artifact.class === "artifact");
check("artifact gets more output than ordinary chat", artifact.maxOutputTokens > shortHardQuestion.maxOutputTokens);
check("artifact still has a finite repair/tool loop", artifact.maxToolSteps === 8);

const code = compileTurnBudget({
  request: "Find the bug, patch the repo, run the tests, and verify the deployment",
  dispatch: "code",
  effort: "high",
  style: "detailed",
  artifactRequested: false,
  hasFiles: true,
  planSteps: 6
});
check("code gets code budget", code.class === "code");
check("code can use more tools than chat", code.maxTools > research.maxTools);
check("code is still capped below the historical 28-step loop", code.maxToolSteps <= 14);
check("even detailed code stays below absolute 8k output", code.maxOutputTokens < 8_000);

const deep = compileTurnBudget({
  request: "Think through the architecture and its failure modes",
  dispatch: "reasoning",
  effort: "high",
  style: "balanced",
  artifactRequested: false,
  hasFiles: false,
  planSteps: 5
});
check("reasoning gets deep budget", deep.class === "deep");
check("deep work remains bounded", deep.maxOutputTokens <= 6_400 && deep.maxToolSteps <= 12);

check("mechanical verify call never inherits answer budget", subcallOutputBudget(code, "verify", 20_000) <= 900);
check("subcall obeys provider room", subcallOutputBudget(code, "step", 600) === 600);

console.log(`${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
