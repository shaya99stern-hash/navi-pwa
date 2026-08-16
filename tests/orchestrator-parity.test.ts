/* PATH: tests/orchestrator-parity.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The gate the shadow-mode migration was waiting on, made mechanical.
 *
 * `planTurn` has been computing a full turn plan for a while and its result has
 * gone to a `console.log` and nowhere else. The chat route explains why: the
 * cluster of inline calls above it decides real turns, and "the way to find out
 * whether a planner agrees with it is to run both against production traffic
 * and read the difference, not to swap one for the other and watch the
 * complaints. Once these lines agree in the logs, the cluster above becomes
 * `plan.route`, `plan.fallbacks` and `plan.lastResort`."
 *
 * That gate could never open. Reading the two side by side, they disagreed in
 * three ways, one of them structural: `TurnContext` had no `preset`, and the
 * inline cluster branches on exactly that — a pinned model outranks the lane
 * entirely. No amount of production traffic would have produced agreement,
 * and flipping the switch anyway would have silently broken every pinned model.
 *
 * So the gate moves here. This reimplements the inline cluster from the same
 * exported primitives it calls, runs both over a cross-product of turn shapes,
 * and asserts they choose the same lane and the same route. Divergence fails a
 * test in CI instead of degrading answers in production until someone notices.
 *
 * One difference is deliberate and is asserted as such at the bottom rather
 * than smoothed away: a coding question asked in Chat mode. See `planTurn`.
 */

const { planTurn } = require("../lib/ai/navi-soul/orchestrator") as typeof import("../lib/ai/navi-soul/orchestrator");
const { classifyIntent } = require("../lib/ai/navi-soul/intent") as typeof import("../lib/ai/navi-soul/intent");
const {
  classifyTask, routeForLane, selectDirectRoute, selectLane
} = require("../lib/ai/providers") as typeof import("../lib/ai/providers");
const { resetProviderHealth } = require("../lib/ai/provider-health") as typeof import("../lib/ai/provider-health");

type Providers = import("../lib/ai/providers").ProviderAvailability;
type Preset = import("../lib/ai/types").ModelPreset;
type Tools = import("../lib/ai/types").ToolPolicy;

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const avail = (on: Partial<Record<string, boolean>>) => ({
  gemini: false, groq: false, huggingface: false, cerebras: false, openrouter: false,
  deepseek: false, mistral: false, together: false, nvidia: false, sambanova: false,
  ...on
}) as Providers;

type Shape = {
  request: string;
  mode: "chat" | "code";
  effort: "low" | "medium" | "high";
  complex: boolean;
  hasFiles: boolean;
  hasImageAttachments: boolean;
  longContext: boolean;
  tools: Tools;
  availability: Providers;
  preset: Preset;
  meteredAllowed: boolean;
  discovered: null;
};

/**
 * What `app/api/chat/route.ts` does inline today, from the same primitives.
 *
 * Deliberately a transcription rather than a tidy-up: every quirk is kept,
 * including that `selectDirectRoute` is computed before the `pinned` branch and
 * can therefore throw for a turn whose lane would have answered. If the route
 * changes, this has to change with it — which is the point. A reference
 * implementation nobody maintains is a test that passes while production drifts.
 */
function inlineDecision(shape: Shape): { lane: number; route: string } | { unconfigured: true } {
  const lane = selectLane({
    mode: shape.mode,
    effort: shape.effort,
    complex: shape.complex,
    hasFiles: shape.hasFiles,
    longContext: shape.longContext
  });

  let generalRoute;
  try {
    generalRoute = selectDirectRoute({
      preset: shape.preset,
      availability: shape.availability,
      hasFiles: shape.hasFiles,
      tools: shape.tools,
      complex: shape.complex
    });
  } catch {
    return { unconfigured: true };
  }

  const pinned = shape.preset !== "navi-soul" && shape.preset !== "navi-code";
  const route = pinned
    ? generalRoute
    : routeForLane({
      lane,
      taskKind: classifyTask(shape.request),
      availability: shape.availability,
      tools: shape.tools,
      hasFiles: shape.hasFiles,
      discovered: lane === 4 ? shape.discovered : null,
      meteredAllowed: shape.meteredAllowed
    }) ?? generalRoute;

  return { lane, route: `${route.provider}:${route.model}` };
}

function plannedDecision(shape: Shape): { lane: number; route: string } | { unconfigured: true } {
  const plan = planTurn(shape);
  if (plan.kind !== "model") return { unconfigured: true };
  return { lane: plan.lane, route: `${plan.route.provider}:${plan.route.model}` };
}

/* ── The matrix ──────────────────────────────────────────────────────────── */

/* Requests that classify as neither code nor image, so `effectiveMode` equals
   `mode` and the one intended difference is held out of the parity sweep. It is
   tested on its own below. */
const NEUTRAL_REQUESTS = [
  "why is the sky blue",
  "summarise the argument in this passage for me",
  "what should I consider before signing a commercial lease"
];

const PRESETS: Preset[] = ["navi-soul", "navi-code", "gemini-direct", "groq-direct", "huggingface-direct"];
const TOOLSETS: Tools[] = [
  { web: false, code: false, artifacts: false },
  { web: true, code: false, artifacts: true },
  { web: false, code: true, artifacts: false }
];
const AVAILABILITIES: Providers[] = [
  avail({ gemini: true, groq: true, huggingface: true }),
  avail({ groq: true }),
  avail({ gemini: true }),
  avail({ huggingface: true, cerebras: true }),
  avail({ groq: true, cerebras: true, openrouter: true, mistral: true }),
  avail({})
];

resetProviderHealth();

const divergences: string[] = [];
let compared = 0;

for (const request of NEUTRAL_REQUESTS) {
  for (const preset of PRESETS) {
    for (const mode of ["chat", "code"] as const) {
      for (const effort of ["low", "medium", "high"] as const) {
        for (const hasFiles of [false, true]) {
          for (const longContext of [false, true]) {
            for (const tools of TOOLSETS) {
              for (const availability of AVAILABILITIES) {
                const shape: Shape = {
                  request, mode, effort,
                  complex: effort === "high",
                  hasFiles, hasImageAttachments: false, longContext,
                  tools, availability, preset,
                  meteredAllowed: false, discovered: null
                };
                compared += 1;
                const inline = JSON.stringify(inlineDecision(shape));
                const planned = JSON.stringify(plannedDecision(shape));
                if (inline !== planned && divergences.length < 8) {
                  divergences.push(
                    `${preset}/${mode}/${effort}${hasFiles ? "/files" : ""}${longContext ? "/long" : ""} `
                    + `tools=${Object.entries(tools).filter(([, on]) => on).map(([name]) => name).join("+") || "none"} `
                    + `→ inline ${inline} vs planned ${planned}`
                  );
                }
              }
            }
          }
        }
      }
    }
  }
}

check("the sweep covers a real cross-product, not a handful of cases", compared > 1_500, true);
check("the planner and the route it replaces choose identically", divergences, []);

/* ── The one difference that is on purpose ───────────────────────────────── */

/* An intent classifier that never changes an outcome is decoration. This is the
   single case where `planTurn` is meant to disagree with the code it replaces,
   so it is pinned here — otherwise the next person reading a parity failure
   would "fix" it by deleting the behaviour it exists to add. */
const codeInChat: Shape = {
  request: "refactor this typescript function to remove the nested callbacks",
  mode: "chat", effort: "medium", complex: false,
  hasFiles: false, hasImageAttachments: false, longContext: false,
  tools: { web: false, code: false, artifacts: false },
  availability: avail({ gemini: true, groq: true, huggingface: true }),
  preset: "navi-soul", meteredAllowed: false, discovered: null
};

check("the request really does read as code", classifyIntent(codeInChat.request, { hasImageAttachments: false, mode: "chat" }).intent, "code");

const inlineLane = (inlineDecision(codeInChat) as { lane: number }).lane;
const plannedLane = (plannedDecision(codeInChat) as { lane: number }).lane;
check("the inline cluster reads only the mode switch, so it stays on a chat lane", inlineLane, 2);
check("the planner routes it as code instead", plannedLane, 4);
check("and that is a difference, deliberately", inlineLane !== plannedLane, true);

/* The override runs one way only. Code mode is a standing instruction from the
   user; a chatty sentence typed into it must not demote the lane. */
const chatInCode = { ...codeInChat, request: "why is the sky blue", mode: "code" as const };
check("a conversational ask in Code mode stays on the code lane",
  JSON.stringify(plannedDecision(chatInCode)), JSON.stringify(inlineDecision(chatInCode)));

console.log(`\n${pass}/${pass + fail} passed  (${compared} turn shapes compared)`);
if (fail) process.exit(1);

export {};
