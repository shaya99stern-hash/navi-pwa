import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preflightPayload } from "../lib/ai/navi-soul/payload-preflight";
import { ROUTES } from "../lib/ai/providers";
import { planTurn, type TurnContext } from "../lib/ai/navi-soul/orchestrator";
import { resetProviderHealth, markProviderFailure } from "../lib/ai/provider-health";
import { artifactAcceptanceInstruction, checkArtifactCompletion } from "../lib/ai/artifact-completion";
import { assessArtifact, artifactScriptError } from "../lib/ai/navi-soul/artifact-quality";
import { createArtifactGate } from "../lib/ai/artifact-gate";

const header = '{"id":"museum","title":"Museum","kind":"html","height":420}';
const fence = (html: string) => `\`\`\`navi-artifact\n${header}\n---\n${html}\n\`\`\``;
const brokenMuseum = '<div id="room"></div><button id="next">Next century</button><script>function renderRoom(){ const current = 0;';
assert.equal(checkArtifactCompletion(fence(brokenMuseum)).ok, false, "the observed half-written museum must never be delivered");
assert.equal(checkArtifactCompletion(`\`\`\`navi-artifact\n${header}\n---\n${brokenMuseum}`).ok, false);
assert.equal(checkArtifactCompletion(fence('<div id="room">Museum</div><script>const current = ;</script>')).ok, false, "closed tags do not make invalid JavaScript executable");
const good = '<div id="room">Welcome to the museum</div><button id="next">Enter</button><script>document.getElementById("next").addEventListener("click", () => { document.getElementById("room").textContent = "Gallery"; });</script>';
assert.deepEqual(checkArtifactCompletion(fence(good)), { ok: true, count: 1 });
assert.deepEqual(checkArtifactCompletion(`${fence(good)}\n${fence(good)}`), { ok: true, count: 2 });
assert.equal(checkArtifactCompletion("I created your museum.").ok, false);
assert.equal(artifactScriptError('<script>globalThis.mustNeverExecute = true;</script>'), null);
assert.equal((globalThis as Record<string, unknown>).mustNeverExecute, undefined, "validation parses but never executes generated code");
assert.match(artifactScriptError('<script src="https://example.com/library.js"></script>')!, /External/);
assert.equal(artifactScriptError('<script type="application/json">{"title":"Museum"}</script>'), null);
assert.equal(assessArtifact(JSON.stringify({ id: "m", title: "M", kind: "html", html: brokenMuseum })).ok, false);
const gate = createArtifactGate();
const output = gate.push(`\`\`\`navi-artifact\n${header}\n---\n${brokenMuseum}`) + gate.flush();
assert.ok(!output.includes("```navi-artifact"), "partial salvage cannot bypass the script check");
assert.match(artifactAcceptanceInstruction("a museum I can walk around"), /camera position/);
assert.match(artifactAcceptanceInstruction("Create a walkable museum artifact"), /NaviScene.mount/);
assert.ok(!artifactAcceptanceInstruction("make a tip calculator").includes("raycast"));
const contract = artifactAcceptanceInstruction("Create a walkable museum");
const repair = "Fix the incomplete camera initialization and finish every script.";
const fitted = preflightPayload({
  route: ROUTES.openRouterReasoning,
  availability: { openrouter: true } as Parameters<typeof preflightPayload>[0]["availability"],
  blocks: [{ name: "base", text: "You are Navi Soul." }, { name: "artifact-contract", text: contract }, { name: "artifact-repair", text: repair }],
  tools: {}, messages: [{ role: "user", content: "Build it" }], outputReserve: 2_400
});
assert.ok(fitted.ok);
if (fitted.ok) {
  assert.ok(fitted.system.includes(contract), "preflight retains the complete spatial contract");
  assert.ok(fitted.system.includes(repair), "preflight retains repair feedback");
}
const routeSource = readFileSync("app/api/chat/route.ts", "utf8");
assert.match(routeSource, /const attemptSystem = attemptBlocks\.map/);
assert.match(routeSource, /blocks: attemptBlocks/, "the chat endpoint must send the same blocks it measured");
assert.match(routeSource, /prepareStep: \(\{ messages \}\) => \(\{ messages: withoutReasoning\(messages\) \}\)/, "tool follow-ups must also strip unsupported reasoning parts");
assert.match(routeSource, /const failure = streamFailure \?\? error/, "the health tracker must receive the real provider rejection");
assert.match(routeSource, /!artifactRequested \|\| typeof availableTools\[name\]\?\.execute === "function"/, "buffered artifact turns cannot strand client-only calls");
const context: TurnContext = { request: "Create an interactive walkable museum artifact", preset: "navi-soul", mode: "chat", effort: "medium", complex: true, hasFiles: false, hasImageAttachments: false, longContext: false, tools: { artifacts: true, code: true, web: false }, availability: { groq: true, cerebras: true, together: true, openrouter: true } as TurnContext["availability"], meteredAllowed: false };
resetProviderHealth();
const planned = planTurn(context);
assert.ok(planned.kind === "model" && planned.route.provider === "openrouter", "a roomy free artifact route must survive the three-attempt cutoff");
markProviderFailure("openrouter", Object.assign(new Error("Forbidden"), { statusCode: 403 }));
const recovered = planTurn(context);
assert.ok(recovered.kind === "model" && recovered.route.provider !== "openrouter", "observed provider health still takes priority");
resetProviderHealth();
console.log("Artifact completion regressions passed.");
