/* PATH: lib/ai/navi-soul/orchestrator.ts  — NEW FILE, copy verbatim. */

import {
  classifyTask,
  engineName,
  fallbackRoutes,
  lastResortRoute,
  routeForLane,
  selectDirectRoute,
  selectLane,
  type Lane,
  type ProviderAvailability
} from "../providers";
import { orderRoutesByHealth } from "../provider-health";
import { needsOrchestrationKnowledge } from "../orchestration-knowledge";
import type { ModelPreset, ProviderRoute, ToolPolicy } from "../types";
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
  /**
   * The model the user pinned, or one of the two automatic profiles.
   *
   * This was missing, and its absence is why the migration this planner was
   * written for could never complete. The chat route branches on it — anything
   * other than `navi-soul` or `navi-code` is an explicit instruction from the
   * user that outranks the lane entirely — and a planner with no way to see the
   * preset cannot reproduce that decision at any value of the other inputs. The
   * route's own note said the switch would be flipped "once these lines agree
   * in the logs"; they would have disagreed forever, and flipping regardless
   * would have quietly broken every pinned model in the app.
   */
  preset: ModelPreset;
  /** From the spend ledger. An unreadable ledger arrives here as false. */
  meteredAllowed: boolean;
  /**
   * The best free coding model discovery found, when its cache was warm.
   *
   * Passed unconditionally. The caller used to gate this on `lane === 4` using
   * a lane it computed itself, which cannot be right for a planner that decides
   * its own lane — so the gate lives here now, applied to the lane actually
   * chosen.
   */
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

/**
 * The route the chat route calls `generalRoute`, or null when there is none.
 *
 * `selectDirectRoute` signals "nothing can serve this" by throwing, with a
 * message already written for the person reading it. A planner that returns a
 * plan rather than raising wants that as a value, so this is the one place the
 * throw is turned back into one.
 *
 * This replaces a `firstAvailableRoute` ladder that lived here and quietly
 * disagreed with the real selector: it tried Gemini first in every case, where
 * `selectDirectRoute` prefers a tool-capable Groq route when tools are on and
 * the largest Cerebras weights at high effort. Two different answers to "which
 * model should serve this turn", one of which no production request has ever
 * used. Keeping both would have meant the planner was only ever an
 * approximation of the thing it was meant to replace.
 */
function directRoute(context: TurnContext): { route: ProviderRoute } | { unavailable: string } {
  try {
    return {
      route: selectDirectRoute({
        preset: context.preset,
        availability: context.availability,
        hasFiles: context.hasFiles,
        tools: context.tools,
        complex: context.complex
      })
    };
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : "No AI provider is configured." };
  }
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

  /* The one place this planner deliberately decides differently from the code
     it replaces, rather than merely reproducing it.

     A coding question asked in Chat mode currently takes a chat lane, because
     the inline selector reads the mode switch and nothing else. Classifying the
     request as code and routing it accordingly is the entire reason an intent
     classifier exists — leaving it out would make `intent.ts` decoration. It is
     called out here, and asserted as an intended difference in the parity
     tests, so it never reads as a mismatch someone should "fix" by removing it.

     The mode switch still wins in the other direction: Code mode stays Code
     mode whatever the request looks like, because that is a standing
     instruction from the user rather than a guess about their sentence. */
  const effectiveMode = intent.intent === "code" ? "code" : context.mode;
  const lane = selectLane({
    mode: effectiveMode,
    effort: context.effort,
    complex: context.complex,
    hasFiles: context.hasFiles,
    longContext: context.longContext
  });

  const direct = directRoute(context);

  /* Checked before the lane, and that order is load-bearing rather than
     stylistic. The chat route evaluates `selectDirectRoute` eagerly, above its
     own `pinned` branch, so a turn that route cannot serve ends there — the
     lane never gets a say. Reproducing the *values* while dropping the
     *sequencing* changed behaviour in the one case that matters:

     a file attached with only Groq configured. Production refuses it honestly
     — "File and image input requires Gemini or a Hugging Face vision route" —
     because `selectDirectRoute` throws on a vision request with no vision
     provider. The lane, asked independently, cheerfully answers `groqTools`,
     because `routeForLane` weighs tool support before it weighs attachments.
     That is a text-only model being handed an image.

     The parity sweep caught it across 6,480 turn shapes before it shipped. */
  if ("unavailable" in direct) return { kind: "unconfigured", message: direct.unavailable };

  /* A pinned model is an explicit instruction and outranks the lane; the two
     automatic profiles let the lane decide and fall back to the direct route
     when the lane has no provider configured. Identical in structure to the
     chat route's own `pinned` branch, because it has to be. */
  const pinned = context.preset !== "navi-soul" && context.preset !== "navi-code";
  const laneRoute = pinned
    ? null
    : routeForLane({
      lane,
      availability: context.availability,
      tools: context.tools,
      hasFiles: context.hasFiles,
      /* The lane-4 gate, applied to the lane this planner actually chose. */
      discovered: lane === 4 ? context.discovered ?? null : null,
      meteredAllowed: context.meteredAllowed,
      taskKind: classifyTask(context.request)
    });

  const primary = laneRoute ?? direct.route;

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
