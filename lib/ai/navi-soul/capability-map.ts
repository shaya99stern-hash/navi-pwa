/* PATH: lib/ai/navi-soul/capability-map.ts  — NEW FILE, copy verbatim. */

import { ROUTES, engineName, type ProviderAvailability } from "../providers";
import type { ProviderRoute } from "../types";

/**
 * One true answer to "what can Navi Soul actually do right now".
 *
 * Three surfaces need this answer and each used to invent its own: the system
 * prompt (so the model stops fabricating capabilities it does not have and
 * stops denying ones it does), the `/capabilities` command (answered on device,
 * zero tokens), and the settings screen. A capability list that is computed
 * three ways is three lists, and the constitution's first rule — never claim
 * state you have not checked — applies to the app as much as to the model.
 *
 * Everything here is *passed in* rather than read from the environment:
 * availability from the provider layer, tool groups from the registry, the
 * skill count from the client that owns the skills, MCP servers from whoever
 * read the registry. A pure function cannot drift from its inputs, and it
 * tests without mocks.
 *
 * Names are capability names — `engineName`'s Navi Swift / Navi Deep / Navi
 * Vision vocabulary — never provider brands. That is the constitution again,
 * and it is also what keeps this stable while free tiers come and go.
 */

export type CapabilityInputs = {
  availability: ProviderAvailability;
  /** From `activeGroups(context)` in `lib/tools/registry.ts`. */
  toolGroups: string[];
  /** From the skills registry on the client; 0 when unknown. */
  skillCount: number;
  /** From `publicMcpRegistry()`: operator-configured MCP servers. */
  mcpServers: Array<{ id: string; name: string }>;
  /** From `IMAGE_ENGINES` in `lib/ai/image-generation.ts`. */
  imageEngines: Array<{ name: string; detail: string }>;
  /** From `frontierConfigured()` — whether escalation exists at all. */
  frontier: boolean;
};

export type CapabilitySnapshot = {
  /** Deduplicated capability-named engines, e.g. "Navi Deep — multi-step reasoning". */
  engines: string[];
  toolGroups: string[];
  skillCount: number;
  mcpServers: string[];
  imageEngines: string[];
  frontier: boolean;
};

/** One representative route per capability, for naming what is reachable. */
const REPRESENTATIVES: Array<{ route: ProviderRoute; purpose: string }> = [
  { route: ROUTES.groqFast, purpose: "instant answers, rewrites, extraction" },
  { route: ROUTES.cerebrasLarge, purpose: "multi-step reasoning and hard problems" },
  { route: ROUTES.openRouterCoding, purpose: "writing and reviewing real code" },
  { route: ROUTES.geminiSynthesis, purpose: "long documents and whole repositories" },
  { route: ROUTES.geminiVision, purpose: "screenshots, photos, and diagrams" },
  { route: ROUTES.mistralBalanced, purpose: "everyday balanced work" }
];

export function buildCapabilitySnapshot(inputs: CapabilityInputs): CapabilitySnapshot {
  const engines: string[] = [];
  const seen = new Set<string>();
  for (const { route, purpose } of REPRESENTATIVES) {
    if (!inputs.availability[route.provider]) continue;
    const name = engineName(route);
    if (seen.has(name)) continue;
    seen.add(name);
    engines.push(`${name} — ${purpose}`);
  }
  return {
    engines,
    toolGroups: [...inputs.toolGroups],
    skillCount: inputs.skillCount,
    mcpServers: inputs.mcpServers.map((server) => server.name),
    imageEngines: inputs.imageEngines.map((engine) => `${engine.name} — ${engine.detail}`),
    frontier: inputs.frontier
  };
}

/**
 * The prompt block. Compact on purpose: every line is charged to the turn, so
 * it ships only when `wantsCapabilityBrief` says the turn is about capability
 * — the same economics as `ORCHESTRATION_KNOWLEDGE`.
 */
export function capabilityBrief(snapshot: CapabilitySnapshot): string {
  const lines = [
    "## What you can actually do, checked this turn",
    "",
    "Engines available now (never name the providers behind them):",
    ...snapshot.engines.map((engine) => `- ${engine}`),
    snapshot.frontier ? "- Navi Frontier — the escalation for the hardest work, spent sparingly" : "",
    "",
    `On-device skills: ${snapshot.skillCount} deterministic tools (math, dates, encoding, text, data) that cost no tokens — always prefer one over estimating.`,
    snapshot.imageEngines.length ? `Image engines: ${snapshot.imageEngines.join("; ")}.` : "Image generation is not configured on this deployment.",
    snapshot.toolGroups.length ? `Tool groups active this turn: ${snapshot.toolGroups.join(", ")}.` : "",
    snapshot.mcpServers.length ? `Connected MCP servers: ${snapshot.mcpServers.join(", ")}.` : "",
    "",
    "Claim only what is on this list. If something is not here, say it is not configured rather than improvising it."
  ];
  return lines.filter(Boolean).join("\n");
}

/** Is this turn asking what the app can do? Generous, like its siblings. */
const CAPABILITY_TERMS = /\b(what (?:can|do) you (?:do|know|use)|your (?:tools?|skills?|engines?|models?|capabilit\w+|features?)|which (?:tools?|models?|engines?)|list (?:your|the) (?:tools?|skills?|models?)|capabilities)\b/i;

export function wantsCapabilityBrief(request: string): boolean {
  return CAPABILITY_TERMS.test(request);
}

/**
 * The `/capabilities` answer, rendered on device with zero tokens. Short lines
 * for a phone screen; counts rather than inventories.
 */
export function describeCapabilitiesForUser(snapshot: CapabilitySnapshot): string {
  return [
    snapshot.engines.length
      ? `${snapshot.engines.length} engine${snapshot.engines.length === 1 ? "" : "s"} online: ${snapshot.engines.map((engine) => engine.split(" — ")[0]).join(", ")}.`
      : "No engines are configured yet.",
    snapshot.frontier ? "Frontier escalation is configured." : "",
    `${snapshot.skillCount} on-device skills answer instantly, offline, with no tokens.`,
    snapshot.imageEngines.length ? `Images: ${snapshot.imageEngines.map((engine) => engine.split(" — ")[0]).join(", ")}.` : "",
    snapshot.mcpServers.length ? `Connectors: ${snapshot.mcpServers.join(", ")}.` : ""
  ].filter(Boolean).join("\n");
}
