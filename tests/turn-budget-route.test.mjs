import { readFileSync } from "node:fs";

const route = readFileSync("app/api/chat/route.ts", "utf8");

let passed = 0;
let failed = 0;

function check(label, pattern) {
  const ok = pattern.test(route);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

function checkAbsent(label, pattern) {
  const ok = !pattern.test(route);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

console.log("--- the live chat executor must obey the compiled turn budget ---");
check(
  "compiles a budget for the current turn",
  /\bcompileTurnBudget\s*\(\s*\{[\s\S]{0,700}?request:\s*lastUserText[\s\S]{0,700}?dispatch[\s\S]{0,700}?artifactRequested[\s\S]{0,700}?hasFiles[\s\S]{0,700}?\}\s*\)/
);
check(
  "keeps the registry as the sole authority for model-visible tools",
  /const\s+availableTools\s*=\s*buildToolset\(toolsetContext\)\s*;/
);
checkAbsent(
  "does not blindly re-trim the registry's relevance-aware toolset",
  /\bcapToolsForTurn\s*\(/
);
check(
  "reserves only the turn's minimum reply room",
  /ceiling\s*-\s*fixed\s*-\s*turnBudget\.minOutputTokens/
);
check(
  "accepts a useful reply at the turn-specific floor",
  /attemptOutputTokens\s*<\s*turnBudget\.minOutputTokens/
);
check(
  "caps streamed answer tokens with the turn budget",
  /const\s+attemptOutputTokens\s*=\s*Math\.min\(\s*turnBudget\.maxOutputTokens\s*,\s*ceiling\s*-\s*input\.total\s*\)/
);
check(
  "caps tool round trips with the turn budget",
  /stopWhen:\s*stepCountIs\(turnBudget\.maxToolSteps\)/
);
check(
  "caps mission engine calls with the turn budget",
  /maxEngineCalls:\s*turnBudget\.maxEngineCalls/
);
check(
  "caps mechanical subcall output with the turn budget",
  /\bsubcallOutputBudget\s*\(\s*turnBudget\s*,\s*purpose\s*,/
);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
