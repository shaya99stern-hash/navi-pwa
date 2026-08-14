/* PATH: lib/ai/navi-soul/router.ts  — REPLACES the copy shipped in
   design_handoff_navios_pro (same path). If that bundle was never applied,
   copy this one; it stands alone. The original replaced
   src/navisoul-intrinsics/router-intrinsics.js, which must be deleted. */

import { calculate, executeSystemCommand, isBasicMath, isSystemCommand, type LocalResult } from "./local-processor";

/**
 * The local-first gate in front of the model.
 *
 * Every request currently costs a round trip to `/api/chat`, an edge cold
 * start, a system prompt, and a provider's latency — including "2+2" and
 * "/ping". Those have exact answers available on the device in under a
 * millisecond, and paying a model for them is both slow and a bill.
 *
 * What this is not: a router that chooses providers. `lib/ai/providers.ts` and
 * `lib/ai/provider-health.ts` own that, and this must never second-guess them.
 * This decides one thing — whether the request needs a model at all.
 */

export type NaviSoulDecision =
  | { route: "local"; response: string; kind: "compute" | "command"; skill?: string }
  /** `/clear` and friends: recognised here, performed by the client. */
  | { route: "client-command"; command: string }
  | { route: "model" };

export function decideLocally(query: string, state: { routes?: string[]; version?: string; online?: boolean } = {}): NaviSoulDecision {
  const text = query.trim();
  if (!text) return { route: "model" };

  if (isSystemCommand(text)) {
    const command = text.toLowerCase();
    const result = executeSystemCommand(command, state);
    if (result.handledLocally) return { route: "local", response: result.response, kind: result.kind };
    /* Recognised but not answerable as text — the client performs it. */
    return { route: "client-command", command };
  }

  if (isBasicMath(text)) {
    const result: LocalResult = calculate(text);
    if (result.handledLocally) return { route: "local", response: result.response, kind: result.kind };
  }

  return { route: "model" };
}

/**
 * The wider doorway: the gate above, then the whole on-device skill library.
 *
 * `instantAnswer` in `lib/skills/instant.ts` already answers dozens of prose
 * shapes — hashes, encodings, conversions, date maths, JSON formatting — with
 * no network and no tokens. It is injected rather than imported because it is
 * a `"use client"` module: the composer passes it on the device, where those
 * skills live, and server callers pass nothing and get the safe subset. One
 * decision function, two depths, no client code in the edge bundle.
 */
export async function decideLocallyWithSkills(
  query: string,
  state: { routes?: string[]; version?: string; online?: boolean } = {},
  tryInstant?: (query: string) => Promise<{ text: string; skill: string } | null>
): Promise<NaviSoulDecision> {
  const gate = decideLocally(query, state);
  if (gate.route !== "model" || !tryInstant) return gate;

  try {
    const hit = await tryInstant(query);
    if (hit) return { route: "local", response: hit.text, kind: "compute", skill: hit.skill };
  } catch {
    /* A skill that throws must never cost the user their turn: the request
       simply proceeds to the model, exactly as if nothing had matched. */
  }
  return gate;
}
