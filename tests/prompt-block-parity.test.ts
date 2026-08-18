/* PATH: tests/prompt-block-parity.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The gate for moving the optional prompt blocks onto `plan.promptBlocks`.
 *
 * `planTurn` has returned a list of the optional blocks each turn earned since
 * it was written, and nothing ever read it. The chat route re-derived one of
 * those decisions inline from the identical predicate, and simply did not
 * assemble the other two — so `capability-brief`, whose entire job is to tell
 * the model what is switched on *right now*, was decided by a function no turn
 * ever reached, and `wantsCapabilityBrief` had no path to production at all.
 *
 * That is the same shape as the routing migration `orchestrator-parity.test.ts`
 * gated, and it gets the same treatment: sweep the turn shapes, assert the plan
 * and the predicate agree, and fail CI on divergence rather than discovering it
 * in an answer months later.
 *
 * One block is deliberately *not* consolidated, and that is asserted at the
 * bottom rather than left as an omission somebody later "finishes".
 */

const { planTurn } = require("../lib/ai/navi-soul/orchestrator") as typeof import("../lib/ai/navi-soul/orchestrator");
const { wantsCapabilityBrief, buildCapabilitySnapshot, capabilityBrief, describeCapabilitiesForUser } =
  require("../lib/ai/navi-soul/capability-map") as typeof import("../lib/ai/navi-soul/capability-map");
const { needsOrchestrationKnowledge } =
  require("../lib/ai/orchestration-knowledge") as typeof import("../lib/ai/orchestration-knowledge");
const { resetProviderHealth } = require("../lib/ai/provider-health") as typeof import("../lib/ai/provider-health");
const { readFileSync } = require("node:fs") as typeof import("node:fs");
const { join } = require("node:path") as typeof import("node:path");

type Providers = import("../lib/ai/providers").ProviderAvailability;
type Tools = import("../lib/ai/types").ToolPolicy;

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

resetProviderHealth();

const availability = {
  gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true,
  deepseek: false, mistral: false, together: false, nvidia: false, sambanova: false
} as Providers;

const tools: Tools = { web: true, code: false, artifacts: true };

/* Chosen to straddle both predicates rather than to pass them: some hit the
   orchestration terms, some the capability terms, some both, some neither. */
const REQUESTS = [
  "what can you do",
  "list your tools",
  "which models do you use",
  "how do you route a request across engines",
  "what are your capabilities and which engines handle them",
  "book a table for four on Thursday",
  "summarise this thread",
  "write a pomodoro timer app with a progress ring",
  "read https://example.com and tell me what changed",
  "what is 12% of 4,300"
];

const EFFORTS: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];
const MODES: Array<"chat" | "code"> = ["chat", "code"];

/* ── The sweep ───────────────────────────────────────────────────────────────
   Both decisions are the plan's now. If either ever stops matching the
   predicate the prompt used to call, that is a block silently appearing in or
   vanishing from every affected turn — the kind of change that shows up as
   "the answers got worse" long after the commit that caused it. */

let orchestrationChecked = 0, capabilityChecked = 0;
let orchestrationMismatch = 0, capabilityMismatch = 0;
/* Both outcomes must actually occur in the sweep, or agreement is vacuous:
   two functions that always say no agree perfectly and prove nothing. */
let orchestrationTrue = 0, capabilityTrue = 0;

for (const request of REQUESTS) {
  for (const effort of EFFORTS) {
    for (const mode of MODES) {
      for (const complex of [false, true]) {
        const plan = planTurn({
          request, mode, effort, complex,
          hasFiles: false, hasImageAttachments: false, longContext: false,
          tools, availability, preset: "navi-soul", meteredAllowed: false, discovered: null
        });
        if (plan.kind !== "model") continue;

        const wantsOrchestration = needsOrchestrationKnowledge(request, effort);
        orchestrationChecked++;
        if (wantsOrchestration) orchestrationTrue++;
        if (plan.promptBlocks.includes("orchestration-knowledge") !== wantsOrchestration) orchestrationMismatch++;

        const wantsCapability = wantsCapabilityBrief(request);
        capabilityChecked++;
        if (wantsCapability) capabilityTrue++;
        if (plan.promptBlocks.includes("capability-brief") !== wantsCapability) capabilityMismatch++;
      }
    }
  }
}

check("the sweep covered every turn shape", orchestrationChecked, REQUESTS.length * EFFORTS.length * MODES.length * 2);
check("the plan and the prompt agree on the orchestration brief", orchestrationMismatch, 0);
check("and on the capability brief", capabilityMismatch, 0);
check("with both answers actually occurring, so agreement is not vacuous",
  orchestrationTrue > 0 && orchestrationTrue < orchestrationChecked, true);
check("for the capability brief too",
  capabilityTrue > 0 && capabilityTrue < capabilityChecked, true);

/* ── What the brief is allowed to say ────────────────────────────────────────
   It is the block that answers "what can you actually do", so every line in it
   is a claim about configuration. A claim it cannot check is the defect it was
   written to remove. */

const snapshot = (over: Partial<Parameters<typeof buildCapabilitySnapshot>[0]> = {}) =>
  buildCapabilitySnapshot({
    availability, toolGroups: ["web"], skillCount: 0,
    mcpServers: [], imageEngines: [], frontier: false, ...over
  });

/* The instant skills live in a `"use client"` module the edge runtime cannot
   import, so a server-built snapshot genuinely has no count. Printing zero
   would tell the model it has no on-device skills, which is false; saying
   nothing is merely quiet. */
check("an unknown skill count is omitted rather than printed as zero",
  capabilityBrief(snapshot()).includes("On-device skills"), false);
check("and a known one is stated",
  capabilityBrief(snapshot({ skillCount: 182 })).includes("On-device skills: 182"), true);
/* Same rule for the user-facing `/capabilities` answer, which is a different
   renderer of the same snapshot and had the same defect. */
check("the user-facing summary omits it too",
  describeCapabilitiesForUser(snapshot()).includes("on-device skills"), false);
check("and states it when it is known",
  describeCapabilitiesForUser(snapshot({ skillCount: 182 })).includes("182 on-device skills"), true);

check("image engines are listed when there are any",
  capabilityBrief(snapshot({ imageEngines: [{ name: "Navi Image", detail: "Everyday images" }] })).includes("Navi Image"), true);
check("and their absence is stated rather than left silent",
  capabilityBrief(snapshot()).includes("Image generation is not configured on this deployment"), true);
/* The instruction that makes the block worth its tokens. */
check("the brief forbids improvising past the list",
  capabilityBrief(snapshot()).includes("say it is not configured rather than improvising it"), true);

/* ── The production wiring ───────────────────────────────────────────────── */

const root = process.cwd();
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");

check("the route reads the plan's block list", /const planBlocks = turnPlan\.kind === "model" \? turnPlan\.promptBlocks : \[\]/.test(route), true);
check("the orchestration block is decided by the plan",
  /promptBlocks\.includes\("orchestration-knowledge"\) \? ORCHESTRATION_KNOWLEDGE/.test(route), true);
check("the capability brief is assembled at all, for the first time",
  /promptBlocks\.includes\("capability-brief"\) && capabilitySnapshot \? capabilityBrief\(capabilitySnapshot\)/.test(route), true);
/* Built once per turn, not once per attempt: the answer cannot change between
   a failed route and its fallback, and the retry path rebuilds the prompt for
   every one of them. */
check("the snapshot is built once per turn rather than per attempt",
  /const capabilities = planBlocks\.includes\("capability-brief"\)/.test(route), true);
/* The brief describes tool groups. Deriving them from anything other than the
   object that built the toolset is how a description drifts from the thing it
   describes. */
check("its tool groups come from the object that built the toolset",
  /toolGroups: activeGroups\(options\.toolsetContext\)/.test(route), true);
/* An engine whose credential is absent is a picture the model cannot draw. */
check("image engines are gated on the credential each one needs",
  /if \(options\.availability\.gemini\) engines\.push/.test(route), true);

/* ── The block deliberately left alone ───────────────────────────────────────
   `plan.promptBlocks` also carries "artifact-discipline", and it is NOT wired
   here. The two predicates are not the same question:

     plan:  intent.intent === "artifact"          (classifyIntent, prose only)
     route: !imageRequested && !audioRequested
            && tools.artifacts && artifactIntent(lastUserText)

   The route's version is gated on the user's own artifact switch and on the
   turn not already being an image or audio request. Consolidating them would
   ship artifact instructions to turns whose artifact tool is switched off —
   a behaviour change wearing a refactor's clothes. It stays where it is until
   someone reconciles the two classifiers deliberately. */

check("the artifact instruction still runs on the route's own gated predicate",
  /tools\.artifacts \? artifactInstruction\(artifactRequested\) : ""/.test(route), true);
check("which is still gated on the user's artifact switch",
  /const artifactRequested = !imageRequested && !audioRequested && tools\.artifacts && artifactIntent\(lastUserText\)/.test(route), true);
check("and the plan's version is not silently wired alongside it",
  /promptBlocks\.includes\("artifact-discipline"\)/.test(route), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
