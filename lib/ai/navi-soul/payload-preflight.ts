/* PATH: lib/ai/navi-soul/payload-preflight.ts  — NEW FILE, copy verbatim. */

import type { ModelMessage, ToolSet } from "ai";
import { estimateMessageTokens, describeRequestSize, measureRequest, type RequestSize } from "../request-size";
import { ROUTES, type ProviderAvailability } from "../providers";
import type { ProviderRoute } from "../types";
import { providerCeiling } from "./provider-ceilings";

/**
 * The guarantee that a request fits before it is sent.
 *
 * `request-size.ts` can measure a payload and `provider-ceilings.ts` knows the
 * limits; this is the module that acts on both. Every turn passes through here
 * after the route is chosen and before the stream opens, and what comes out is
 * either a payload that fits the chosen provider, the same payload refitted to
 * a bigger-context provider, or a refusal that names the largest contributor —
 * never a request sent on hope.
 *
 * Shrinking is deterministic and ordered by what a turn loses least:
 *
 *   1. Optional prompt blocks are dropped, last first — the caller orders them
 *      by value, so the least valuable goes first. Required blocks never drop.
 *   2. Tools are trimmed from the end of the set, matching `capToolset`'s
 *      contract that earlier entries matter more.
 *   3. History is truncated oldest-first. The newest message is the request
 *      itself and always survives; if it alone exceeds the budget its middle
 *      is clipped, visibly, rather than the request failing.
 *
 * Only when the *required* payload cannot fit does the reroute fire, and only
 * to free routes — a preflight that quietly moves a turn onto a metered lane
 * would be a billing decision made by a byte counter.
 */

export type PromptBlock = {
  name: string;
  text: string;
  /** Optional blocks may be dropped for size, in reverse array order. */
  optional?: boolean;
};

export type PreflightOutcome =
  | {
      ok: true;
      route: ProviderRoute;
      rerouted: boolean;
      system: string;
      tools: ToolSet;
      messages: ModelMessage[];
      size: RequestSize;
      droppedBlocks: string[];
      removedTools: number;
      removedMessages: number;
      clippedLastMessage: boolean;
    }
  | { ok: false; reason: string; size: RequestSize };

/** Below this many tools, trimming stops: diagnostics and skills stay. */
const TOOL_FLOOR = 6;

/**
 * Keep the first `max` tools. The same trim `capToolset` performs, restated
 * here so the preflight (and its tests) do not pull the whole builder graph
 * into scope; the ordering contract — earlier entries outrank later — is the
 * registry's, unchanged.
 */
function trimToolset(tools: ToolSet, max: number): ToolSet {
  const names = Object.keys(tools);
  if (names.length <= max) return tools;
  const kept: ToolSet = {};
  for (const name of names.slice(0, max)) kept[name] = tools[name];
  return kept;
}

/**
 * Newest-first message retention inside a token budget.
 *
 * Contiguous from the tail on purpose: dropping the middle of a conversation
 * leaves the model holding replies to messages it never saw, which reads as
 * confusion. Oldest turns go first, whole, and the final message — the request
 * being answered — survives unconditionally, clipped in the middle when it
 * alone is over budget, with a visible marker so nobody wonders why the model
 * ignored page three of a paste.
 */
export function truncateMessagesToBudget(
  messages: ModelMessage[],
  budgetTokens: number
): { messages: ModelMessage[]; removed: number; clipped: boolean } {
  if (!messages.length) return { messages, removed: 0, clipped: false };

  const kept: ModelMessage[] = [];
  let used = 0;
  let removed = 0;
  let clipped = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateMessageTokens([message]);

    if (!kept.length) {
      let final = message;
      if (cost > budgetTokens && typeof message.content === "string") {
        const budgetChars = Math.max(2_000, budgetTokens * 4 - 400);
        const head = message.content.slice(0, Math.floor(budgetChars * 0.8));
        const tail = message.content.slice(message.content.length - Math.floor(budgetChars * 0.2));
        final = {
          ...message,
          content: `${head}\n\n[Navi Soul trimmed the middle of this message to fit the engine's request ceiling.]\n\n${tail}`
        } as ModelMessage;
        clipped = true;
      }
      kept.unshift(final);
      used += estimateMessageTokens([final]);
      continue;
    }

    if (used + cost > budgetTokens) {
      removed = index + 1;
      break;
    }
    kept.unshift(message);
    used += cost;
  }

  return { messages: kept, removed, clipped };
}

function composeSystem(blocks: PromptBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

type PreflightInput = {
  route: ProviderRoute;
  availability: ProviderAvailability;
  /** Ordered by value, most important first. Required blocks never drop. */
  blocks: PromptBlock[];
  tools: ToolSet;
  messages: ModelMessage[];
  /** The `maxOutputTokens` this turn will reserve. Counted; providers count it. */
  outputReserve: number;
};

function tryFit(route: ProviderRoute, rerouted: boolean, input: PreflightInput): PreflightOutcome {
  const ceiling = providerCeiling(route.provider);
  const originalToolCount = Object.keys(input.tools).length;

  let blocks = [...input.blocks];
  let tools = input.tools;
  let messages = input.messages;
  const droppedBlocks: string[] = [];
  let removedMessages = 0;
  let clippedLastMessage = false;

  const measure = () =>
    measureRequest({ system: composeSystem(blocks), tools, messages, output: input.outputReserve });

  let size = measure();

  /* 1. Optional prompt blocks, least valuable (last) first. */
  while (size.total > ceiling) {
    const index = blocks.map((block) => Boolean(block.optional)).lastIndexOf(true);
    if (index === -1) break;
    droppedBlocks.push(blocks[index].name);
    blocks.splice(index, 1);
    size = measure();
  }

  /* 2. Tools, from the end, never below the floor. */
  while (size.total > ceiling && Object.keys(tools).length > TOOL_FLOOR) {
    tools = trimToolset(tools, Math.max(TOOL_FLOOR, Math.floor(Object.keys(tools).length / 2)));
    size = measure();
  }

  /* 3. History, oldest first; the request itself always survives. */
  if (size.total > ceiling) {
    const budget = ceiling - size.system - size.tools - size.output;
    if (budget > 0) {
      const truncated = truncateMessagesToBudget(messages, budget);
      messages = truncated.messages;
      removedMessages = truncated.removed;
      clippedLastMessage = truncated.clipped;
      size = measure();
    }
  }

  if (size.total > ceiling) {
    return { ok: false, reason: describeRequestSize(size, ceiling), size };
  }

  return {
    ok: true,
    route,
    rerouted,
    system: composeSystem(blocks),
    tools,
    messages,
    size,
    droppedBlocks,
    removedTools: originalToolCount - Object.keys(tools).length,
    removedMessages,
    clippedLastMessage
  };
}

/**
 * Routes worth rerouting to when nothing else fits: free, long-context, and
 * ordered here by ceiling at call time. Metered routes are deliberately
 * absent — see the module comment.
 */
function contextCandidates(availability: ProviderAvailability, current: ProviderRoute): ProviderRoute[] {
  const currentCeiling = providerCeiling(current.provider);
  return [ROUTES.geminiSynthesis, ROUTES.hfGlm, ROUTES.openRouterReasoning]
    .filter(
      (route) =>
        availability[route.provider] &&
        route.provider !== current.provider &&
        providerCeiling(route.provider) > currentCeiling
    )
    .sort((left, right) => providerCeiling(right.provider) - providerCeiling(left.provider));
}

export function preflightPayload(input: PreflightInput): PreflightOutcome {
  const primary = tryFit(input.route, false, input);
  if (primary.ok) return primary;

  for (const candidate of contextCandidates(input.availability, input.route)) {
    const fitted = tryFit(candidate, true, input);
    if (fitted.ok) return fitted;
  }

  /* Nothing configured can carry it. The refusal names the largest
     contributor, which is the difference between an error and a bug report. */
  return primary;
}
