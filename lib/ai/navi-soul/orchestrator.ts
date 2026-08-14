/* PATH: lib/ai/navi-soul/orchestrator.ts  — NEW FILE, copy verbatim. */

import {
  classifyTask,
  engineName,
  fallbackRoutes,
  lastResortRoute,
  routeForLane,
  selectLane,
  ROUTES,
  type Lane,
  type ProviderAvailability
} from "../providers";
import { orderRoutesByHealth } from "../provider-health";
import { needsOrchestrationKnowledge } from "../orchestration-knowledge";
import type { ProviderRoute, ToolPolicy } from "../types";
import { classifyIntent, wantsFreshInformation, type IntentDecision } from "./intent";
import { wantsCapabilityBrief } from "./capability-map";

/**
 * The one place a turn's whole plan is decided.
 *
 * Everything this composes already exists and already works: lanes and routes
 * in `providers.ts`, cross-request health in `provider-health.ts`, the
 * mechanical fast-path in `classifyTask`, the metered floor in
 * `lastResortRoute`. What did not exist was a single call that produces the
 * complete decision — pipeline, lane, primary route, health-ordered fallbacks,
 * last resort, and which optional prompt blocks this turn has earned — so the
 * chat route assembled it inline, in an order only it knew, and every new rule
 * meant another splice into a 100 KB file.
 *
 * `planTurn` is synchronous and pure given its inputs. It never reads a
 * ledger, never fetches a catalogue, never holds a credential: the caller
 * resolves `meteredAllowed` from the spend ledger and `discovered` from model
 * discovery, because a planner that does I/O is a planner that cannot be
 * tested by calling it.
 *
 * Lane 0 — the on-device answers — never reaches here. `decideLocally` and
 * `instantAnswer` run before any request is made, which is what "zero tokens"
 * means in this app: not a cheaper model call, no call at all.
 */

export type TurnContext = {
  request: string;
  mode: "chat" | "code";
  effort: "low" | "medium" | "high";
  /** The route selector's existing complexity judgement, unchanged. */
  complex: boolean;
  hasFiles: boolean;
  hasImageAttachments: boolean;
  longContext: boolean;
  tools: ToolPolicy;
  availability: ProviderAvailability;
  /** From the spend ledger. An unreadable ledger arrives here as false. */
  meteredAllowed: boolean;
  /** The best free coding model discovery found, when its cache was warm. */
  discovered?: ProviderRoute | null;
};

export type TurnPlan =
  | { kind: "image"; mode: "create" | "edit"; intent: IntentDecision }
  | {
      kind: "model";
      intent: IntentDecision;
      lane: Lane;
      route: ProviderRoute;
      /** Health-ordered alternates; a cooling primary is already demoted. */
      fallbacks: ProviderRoute[];
      /** The metered floor, or null — see `lastResortRoute`. */
      lastResort: ProviderRoute | null;
      /** The user-facing engine name for the status line. */
      engine: string;
      /** Optional prompt blocks this turn has earned, by name. */
      promptBlocks: string[];
      /** The turn plainly wants current information (subject to `tools.web`). */
      wantsFreshInformation: boolean;
    }
  | { kind: "unconfigured"; message: string };

/** The generalist scan `selectDirectRoute` ends with, as a lane fallback. */
function firstAvailableRoute(availability: ProviderAvailability, complex: boolean): ProviderRoute | null {
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.groq) return complex ? ROUTES.groqReasoning : ROUTES.groqFast;
  if (availability.huggingface) return complex ? ROUTES.hfGptOss : ROUTES.hfQwen;
  if (availability.cerebras) return complex ? ROUTES.cerebrasLarge : ROUTES.cerebrasFast;
  if (availability.mistral) return ROUTES.mistralBalanced;
  if (availability.openrouter) return ROUTES.openRouterReasoning;
  if (availability.together) return ROUTES.togetherReasoning;
  if (availability.nvidia) return ROUTES.nvidiaReasoning;
  if (availability.sambanova) return ROUTES.sambanovaFast;
  return null;
}

export function planTurn(context: TurnContext): TurnPlan {
  const intent = classifyIntent(context.request, {
    hasImageAttachments: context.hasImageAttachments,
    mode: context.mode
  });

  /* Image work has its own pipeline with its own engines and its own prompt
     contract. Only certainty short-circuits: a "likely" reading stays a model
     turn, where the model can still choose the image tool deliberately. */
  if ((intent.intent === "image-create" || intent.intent === "image-edit") && intent.confidence === "certain") {
    return { kind: "image", mode: intent.intent === "image-edit" ? "edit" : "create", intent };
  }

  const effectiveMode = intent.intent === "code" ? "code" : context.mode;
  const lane = selectLane({
    mode: effectiveMode,
    effort: context.effort,
    complex: context.complex,
    hasFiles: context.hasFiles,
    longContext: context.longContext
  });

  const primary =
    routeForLane({
      lane,
      availability: context.availability,
      tools: context.tools,
      hasFiles: context.hasFiles,
      discovered: context.discovered ?? null,
      meteredAllowed: context.meteredAllowed,
      taskKind: classifyTask(context.request)
    }) ?? firstAvailableRoute(context.availability, context.complex);

  if (!primary) {
    return {
      kind: "unconfigured",
      message:
        "No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in your Vercel project settings, then redeploy."
    };
  }

  /* Health last, over the whole line: a cooling primary is demoted behind
     healthy alternates but never dropped — if everything is cooling,
     everything is still tried, in the original order. */
  const ordered = orderRoutesByHealth([
    primary,
    ...fallbackRoutes({ primary, availability: context.availability, complex: context.complex })
  ]);

  const promptBlocks: string[] = [];
  if (needsOrchestrationKnowledge(context.request, context.effort)) promptBlocks.push("orchestration-knowledge");
  if (wantsCapabilityBrief(context.request)) promptBlocks.push("capability-brief");
  if (intent.intent === "artifact") promptBlocks.push("artifact-discipline");

  return {
    kind: "model",
    intent,
    lane,
    route: ordered[0],
    fallbacks: ordered.slice(1),
    lastResort: lastResortRoute(context.availability, context.meteredAllowed),
    engine: engineName(ordered[0]),
    promptBlocks,
    wantsFreshInformation: wantsFreshInformation(context.request) && context.tools.web
  };
}

/** One log line per plan, for the person reading runtime logs mid-incident. */
export function describePlan(plan: TurnPlan): string {
  if (plan.kind === "image") return `image turn (${plan.mode}): ${plan.intent.reason}`;
  if (plan.kind === "unconfigured") return "unconfigured: no provider available";
  const blocks = plan.promptBlocks.length ? `, +${plan.promptBlocks.join(" +")}` : "";
  return `model turn: lane ${plan.lane}, ${plan.engine}, ${plan.fallbacks.length} fallback${plan.fallbacks.length === 1 ? "" : "s"}${plan.lastResort ? ", floor armed" : ""}${blocks} (${plan.intent.intent}: ${plan.intent.reason})`;
}
