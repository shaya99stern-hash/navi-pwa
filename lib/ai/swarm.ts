import { generateText, type ModelMessage } from "ai";
import { createProviderModel, availableDraftRoutes, getProviderAvailability, selectSynthesisRoute, selectVerificationRoute } from "./providers";
import type { NaviStreamStatus, ResponseStyle, ToolPolicy } from "./types";
import { validateArtifactPayload } from "../security/artifacts";

const MAX_DRAFT_TOKENS = 760;
const MAX_SYNTHESIS_TOKENS = 1_700;
const MAX_VERIFY_TOKENS = 1_850;

type CompositeOptions = {
  profile: "fable-5" | "opus-4-8";
  messages: ModelMessage[];
  origin: string;
  style: ResponseStyle;
  tools: ToolPolicy;
  threadSummary?: string;
  mcpContext?: string;
  onStage: (status: NaviStreamStatus) => void;
  abortSignal: AbortSignal;
};

function responseStyleInstruction(style: ResponseStyle): string {
  if (style === "concise") return "Return a compact answer with no filler.";
  if (style === "detailed") return "Return a complete, structured answer with all necessary context.";
  return "Lead with the answer, then add the detail needed to make it useful.";
}

function baseSystem(style: ResponseStyle, tools: ToolPolicy): string {
  return [
    "You are an internal Navi orchestration agent.",
    "Be accurate, concrete, and honest about uncertainty.",
    "Do not claim that tools, browsing, files, accounts, or external sources were used unless the supplied context proves it.",
    responseStyleInstruction(style),
    tools.artifacts
      ? "When a genuinely useful interactive result is requested, you may emit a fenced navi-artifact JSON payload with id, title, kind, html or svg, and height."
      : "Do not emit interactive artifact payloads."
  ].join("\n");
}

function validateArtifactFences(text: string): string {
  return text.replace(/```navi-artifact\s*([\s\S]*?)```/gi, (full, json: string) => {
    try {
      const validation = validateArtifactPayload(JSON.parse(json.trim()));
      return validation.ok ? full : `\n> Navi removed an invalid artifact payload: ${validation.error}\n`;
    } catch {
      return "\n> Navi removed a malformed artifact payload.\n";
    }
  });
}

function removeUnresolvedPlaceholders(text: string): string {
  return text
    .replace(/\{\{[^{}]{1,120}\}\}/g, "")
    .replace(/\[(?:TODO|PLACEHOLDER|INSERT[^\]]*)\]/gi, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

export async function runComposite(options: CompositeOptions): Promise<{ text: string; label: string }> {
  const { profile, messages, origin, style, tools, threadSummary, mcpContext, onStage, abortSignal } = options;
  const availability = getProviderAvailability();
  const allRoutes = availableDraftRoutes(availability, tools);
  const routes = allRoutes.slice(0, profile === "opus-4-8" ? 3 : 2);
  if (routes.length === 0) throw new Error("No AI provider key is configured in Vercel.");

  onStage({ stage: "draft", detail: `Running ${routes.length} independent Navi draft agent${routes.length === 1 ? "" : "s"}.` });

  const contextNote = [
    threadSummary ? `Compact thread summary:\n${threadSummary}` : "",
    mcpContext ? `Connected MCP metadata:\n${mcpContext}` : ""
  ].filter(Boolean).join("\n\n");

  const draftResults = await Promise.allSettled(
    routes.map(async (route, index) => {
      const result = await generateText({
        model: createProviderModel(route, origin),
        system: `${baseSystem(style, tools)}\nYou are Draft Agent ${String.fromCharCode(65 + index)}. Solve the request independently. Identify assumptions and likely failure points.\n${contextNote}`,
        messages,
        maxOutputTokens: MAX_DRAFT_TOKENS,
        maxRetries: 1,
        timeout: { totalMs: 22_000 },
        abortSignal
      });
      return { route, text: result.text.trim() };
    })
  );

  const drafts = draftResults
    .filter((result): result is PromiseFulfilledResult<{ route: (typeof routes)[number]; text: string }> => result.status === "fulfilled" && Boolean(result.value.text))
    .map((result) => result.value);

  if (drafts.length === 0) throw new Error("All Navi draft agents failed or were rate-limited.");

  onStage({ stage: "synthesize", detail: "Reconciling the strongest points and contradictions." });
  const synthesisRoute = selectSynthesisRoute(availability, profile);
  const synthesisPrompt = [
    `You are the synthesis agent for ${profile === "fable-5" ? "Fable 5 — Navi MoA" : "Opus 4.8 — Navi MoA"}.`,
    "Create one candidate answer from the independent drafts below.",
    "Resolve disagreements rather than averaging them. Do not mention agents, providers, or this orchestration process.",
    "Preserve valid navi-artifact fenced payloads only when they conform to the requested schema.",
    ...drafts.map((draft, index) => `\n--- Draft ${index + 1} ---\n${draft.text}`)
  ].join("\n");

  const synthesis = await generateText({
    model: createProviderModel(synthesisRoute, origin),
    system: baseSystem(style, tools),
    messages: [...messages, { role: "user", content: synthesisPrompt }],
    maxOutputTokens: MAX_SYNTHESIS_TOKENS,
    maxRetries: 1,
    timeout: { totalMs: 25_000 },
    abortSignal
  });

  onStage({ stage: "verify", detail: "Checking contradictions, unsupported claims, and output safety." });
  const verificationRoute = selectVerificationRoute(availability, synthesisRoute.provider);
  const verificationPrompt = [
    "You are Navi's final verification agent.",
    "Audit the candidate answer against the original conversation and draft evidence.",
    "Fix contradictions, unsupported claims, unresolved placeholders, malformed Markdown, and invalid artifact JSON.",
    "Never invent citations or claim a tool was used without supplied evidence.",
    "Return only the corrected final answer. Do not describe the audit.",
    `\n--- Candidate answer ---\n${synthesis.text}`,
    ...drafts.map((draft, index) => `\n--- Draft evidence ${index + 1} ---\n${draft.text}`)
  ].join("\n");

  const verified = await generateText({
    model: createProviderModel(verificationRoute, origin),
    system: baseSystem(style, tools),
    messages: [...messages, { role: "user", content: verificationPrompt }],
    maxOutputTokens: MAX_VERIFY_TOKENS,
    maxRetries: 1,
    timeout: { totalMs: 25_000 },
    abortSignal
  });

  const cleaned = validateArtifactFences(removeUnresolvedPlaceholders(verified.text || synthesis.text));
  if (!cleaned) throw new Error("Navi verification produced an empty response.");

  return {
    text: cleaned,
    label: profile === "fable-5" ? "Fable 5 — Navi MoA" : "Opus 4.8 — Navi MoA"
  };
}
