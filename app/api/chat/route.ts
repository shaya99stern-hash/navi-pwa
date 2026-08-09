import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  smoothStream,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage
} from "ai";
import { compactForBudget } from "@/lib/ai/compaction";
import { PROVIDERS } from "@/lib/ai/provider-registry";
import { generateNaviImage, type ImageAttachment } from "@/lib/ai/image-generation";
import { audioGenerationIntent, classifyAudioRequest, generateNaviAudio } from "@/lib/ai/audio-generation";
import { createProviderModel, fallbackRoutes, getProviderAvailability, routeForLane, routeToolCallingSupport, selectDirectRoute, selectLane } from "@/lib/ai/providers";
import { markProviderFailure, markProviderSuccess, orderRoutesByHealth } from "@/lib/ai/provider-health";
import { cachedRoute, refreshFreeModels } from "@/lib/ai/model-discovery";
import { getSpendStore, meteredLaneEnabled, readSpend, recordSpend, readUsage } from "@/lib/ai/spend";
import { buildMcpTools } from "@/lib/ai/mcp-tools";
import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import { readUntilCommitted } from "@/lib/ai/lane-commit";
import { githubWritesEnabled, readGithubToken } from "@/lib/github/oauth";
import { googleAccessToken } from "@/lib/google/oauth";
import { factsBlock, factsConfigured, listFacts, rememberFact } from "@/lib/memory/facts";
import { learnedSkillsBlock, learnedSkillsConfigured, listLearnedSkills } from "@/lib/memory/learned-skills";
import { extractFacts, looksDurable } from "@/lib/memory/extract";
import { hasWebSearch } from "@/lib/ai/web-tools";
import { executionInstruction, MAX_REPAIR_ROUNDS } from "@/lib/ai/execution-tools";
import { buildToolset } from "@/lib/tools/registry";
import { detectRepo, retrieveFiles } from "@/lib/ai/repo-retrieval";
import { critiqueAllowed, groundingFor, skipReason } from "@/lib/ai/grounding";
import { runComposite } from "@/lib/ai/swarm";
import {
  architectPlan,
  constraintBlock,
  heuristicPlan,
  reviewDraft,
  shouldConsultArchitect,
  type ExecutionPlan
} from "@/lib/ai/architect";
import type { ConnectorAccessMode, CustomConnector, EffortLevel, ModelPreset, NaviMode, NaviStreamStatus, ResponseStyle, SwarmPreset, ToolPolicy } from "@/lib/ai/types";
import { authorizeApiMutation } from "@/lib/auth/api";
import { gatherMcpMetadata } from "@/lib/mcp";
import { APP_KNOWLEDGE } from "@/lib/ai/app-knowledge";
import { NAVI_MISSION, needsMission } from "@/lib/ai/mission";
import { ORCHESTRATION_KNOWLEDGE, needsOrchestrationKnowledge } from "@/lib/ai/orchestration-knowledge";
import { needsAppKnowledge, stablePrefix } from "@/lib/ai/prompt/base";
import { csvToMarkdown, documentBlock, extractPdfText } from "@/lib/ai/document-text";

export const runtime = "edge";
export const maxDuration = 60;
/**
 * Tool round trips share the request budget, so cap how many the model may take.
 *
 * Raised from four. The SDK's own default is twenty, which bounds nothing worth
 * bounding on a phone; eight is the spec's number and it is deliberate. Four
 * was set when the only tools were search and a clock, and it is too tight now
 * that code execution is available in Chat mode as well: generate, run, read
 * the error, fix, run again is already four, so a repair loop could be cut off
 * at exactly the point it was about to succeed.
 */
const MAX_TOOL_STEPS = 8;
/**
 * Code mode earns more hops: finding a bug is list repos → list directory →
 * read file → check CI → read log → answer, and cutting that off at four
 * leaves the model guessing at exactly the point it was about to know.
 */
const MAX_CODE_TOOL_STEPS = 8;
/**
 * The wall-clock the whole request has, kept under the 60s edge ceiling so a
 * review that starts late is skipped rather than started and killed.
 */
const REQUEST_BUDGET_MS = 52_000;
const REVIEW_DELIVERY_RESERVE_MS = 2_000;
/** Past this many turns a conversation is a context problem, not a hard one. */
const LONG_CONTEXT_TURNS = 14;
/**
 * How much of a model's window the conversation may occupy.
 *
 * The rest is not slack: the system prompt, retrieved files, attached
 * documents, tool schemas and the reply itself all come out of the same
 * window, and none of them is counted by `estimateTokens`. Budgeting the
 * conversation at the full context length is how a request that looks like it
 * fits gets rejected for being over it.
 */
const CONTEXT_INPUT_SHARE = 0.6;

type ChatRequestBody = {
  messages?: UIMessage[];
  mode?: unknown;
  /** Diagnostics-only route pin. Absent for every ordinary request. */
  routeOverride?: unknown;
  /** Accepted so a client that has not reloaded since v4.2.0 still works. */
  preset?: unknown;
  style?: ResponseStyle;
  effort?: unknown;
  tools?: Partial<ToolPolicy>;
  threadSummary?: string;
  memory?: string;
  /** May this turn add to durable memory? False under incognito or the switch. */
  remember?: boolean;
  playbook?: string;
  connectedMcpServers?: string[];
  customConnectors?: unknown;
  connectorAccessMode?: unknown;
  projectContext?: unknown;
  userContext?: unknown;
};

type UserContextInput = {
  displayName?: unknown;
  work?: unknown;
  instructions?: unknown;
};

type ProjectContextInput = {
  id?: unknown;
  name?: unknown;
  instructions?: unknown;
  knowledge?: unknown;
};

type RateBucket = { count: number; resetAt: number };
type FilePart = { mediaType?: string; url?: string; filename?: string };
type Effort = "normal" | "complex" | "extreme";

const REQUEST_WINDOW_MS = 60_000;
/**
 * A person typing quickly, retrying a failed send, or bouncing between models
 * hits far more than a dozen requests in a minute, and being throttled for it
 * reads as the app being broken. This still bounds abuse; it no longer
 * punishes ordinary use.
 */
const REQUESTS_PER_WINDOW = 60;
const MAX_MESSAGES = 50;
const MAX_SERIALIZED_CHARACTERS = 18_000_000;
const MAX_OUTPUT_TOKENS = 1_900;
const ALLOWED_PRESETS = new Set<ModelPreset>([
  "navi-soul",
  "navi-code",
  "auto",
  "navi-fable",
  "navi-sol",
  "gemini-direct",
  "groq-direct",
  "huggingface-direct"
]);
const ALLOWED_STYLES = new Set<ResponseStyle>(["balanced", "concise", "detailed"]);
const ALLOWED_EFFORTS = new Set<EffortLevel>(["low", "medium", "high"]);
/** The scale was briefly five levels; fold the retired top two into High. */
const RETIRED_EFFORTS: Record<string, EffortLevel> = { extra: "high", max: "high" };
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv"
]);
const IMAGE_MEDIA_TYPES = new Set<ImageAttachment["mimeType"]>(["image/jpeg", "image/png", "image/webp"]);

const globalRateState = globalThis as typeof globalThis & { __naviV4RateBuckets?: Map<string, RateBucket> };
const rateBuckets = globalRateState.__naviV4RateBuckets ?? (globalRateState.__naviV4RateBuckets = new Map());

/** A v4.2.0 client still sends a preset; map it to the mode it expressed. */
const LEGACY_PRESET_MODE: Record<string, NaviMode> = {
  "navi-code": "code", "navi-fable": "code", "navi-5": "code", "fable-5": "code",
  "navi-soul": "chat", "navi-sol": "chat", "navi-chat": "chat", auto: "chat",
  "gemini-direct": "chat", "groq-direct": "chat", "huggingface-direct": "chat"
};

function normalizePreset(value: unknown): ModelPreset {
  const legacy: Record<string, ModelPreset> = {
    "navi-5": "navi-fable",
    "fable-5": "navi-fable",
    "navi-sol-5-6": "navi-sol",
    "opus-4-8": "navi-sol",
    "navi-chat": "navi-soul",
    auto: "navi-soul"
  };
  const normalized = legacy[String(value ?? "")] ?? value;
  return typeof normalized === "string" && ALLOWED_PRESETS.has(normalized as ModelPreset)
    ? normalized as ModelPreset
    : "navi-soul";
}

function normalizeConnectorAccessMode(value: unknown): ConnectorAccessMode {
  return value === "auto" || value === "always" ? value : "ask";
}

/** Connectors typed in on the device. Anything malformed is dropped, not fixed. */
function parseCustomConnectors(value: unknown): CustomConnector[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is CustomConnector => {
      if (!entry || typeof entry !== "object") return false;
      const connector = entry as Partial<CustomConnector>;
      return typeof connector.id === "string"
        && typeof connector.name === "string" && connector.name.trim().length > 0 && connector.name.length <= 60
        && typeof connector.baseUrl === "string" && connector.baseUrl.startsWith("https://")
        && typeof connector.apiKey === "string" && connector.apiKey.length > 0 && connector.apiKey.length <= 500
        && (connector.kind === "openai" || connector.kind === "anthropic" || connector.kind === "supabase" || connector.kind === "mcp");
    })
    .slice(0, 12);
}

function projectContextSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const project = value as ProjectContextInput;
  const name = typeof project.name === "string" ? project.name.trim().slice(0, 100) : "";
  if (!name) return "";
  const instructions = typeof project.instructions === "string" ? project.instructions.trim().slice(0, 4_000) : "";
  const knowledge = Array.isArray(project.knowledge)
    ? project.knowledge
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 700))
      .filter(Boolean)
      .slice(0, 30)
    : [];
  return [
    `Active project: ${name}`,
    instructions ? `Project instructions:\n${instructions}` : "",
    knowledge.length ? `Project knowledge:\n${knowledge.map((item) => `- ${item}`).join("\n")}` : "",
    "Treat project instructions and knowledge as durable user-provided context. Do not claim they came from external sources."
  ].filter(Boolean).join("\n\n").slice(0, 6_000);
}

function clientIdentifier(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  const bucket = rateBuckets.get(identifier);
  if (!bucket) {
    rateBuckets.set(identifier, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return false;
  }
  if (bucket.count >= REQUESTS_PER_WINDOW) return true;
  bucket.count += 1;
  return false;
}

function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function fileParts(messages: UIMessage[]): FilePart[] {
  return messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "file")
      .map((part) => part as unknown as FilePart)
  );
}

function imageAttachments(message: UIMessage | undefined): ImageAttachment[] {
  if (!message) return [];
  return message.parts.flatMap((part) => {
    if (part.type !== "file") return [];
    const file = part as unknown as FilePart;
    if (!file.mediaType || !IMAGE_MEDIA_TYPES.has(file.mediaType as ImageAttachment["mimeType"])) return [];
    if (!file.url?.startsWith("data:")) return [];
    const comma = file.url.indexOf(",");
    if (comma < 0) return [];
    const data = file.url.slice(comma + 1).replace(/\s+/g, "");
    if (!data) return [];
    return [{ mimeType: file.mediaType as ImageAttachment["mimeType"], data }];
  });
}

function validateFiles(messages: UIMessage[]): string | null {
  const files = fileParts(messages);
  if (files.length > 6) return "A maximum of six files may be attached to one request.";
  let totalEstimatedBytes = 0;
  for (const file of files) {
    if (!file.mediaType || !ALLOWED_MEDIA_TYPES.has(file.mediaType)) return `Unsupported attachment type: ${file.mediaType ?? "unknown"}.`;
    if (file.url?.startsWith("data:")) {
      const encoded = file.url.split(",")[1] ?? "";
      const estimatedBytes = Math.ceil(encoded.length * 0.75);
      if (estimatedBytes > 6_000_000) return `${file.filename ?? "Attachment"} exceeds the 6 MB limit.`;
      totalEstimatedBytes += estimatedBytes;
    }
  }
  return totalEstimatedBytes > 10_000_000 ? "Combined attachments exceed the 10 MB request limit." : null;
}

function complexity(text: string): Effort {
  const extreme = text.length > 1_800 || /\b(exhaustive|deep audit|production-ready|entire codebase|long-horizon|multi-agent|research report|principal architect)\b/i.test(text);
  if (extreme) return "extreme";
  const complex = text.length > 650 || /\b(architecture|audit|analy[sz]e|debug|proof|strategy|compare|research|legal|financial|medical|typescript|javascript|react|next\.?js|python|sql|multi-step|comprehensive)\b/i.test(text);
  return complex ? "complex" : "normal";
}

/**
 * What Soul is actually being asked for.
 *
 * Soul is the lead: one entry in the picker, dispatching to whichever engine
 * leads at the job. Complexity alone is the wrong signal for that — "fix this
 * TypeScript error" is short and easy but wants a coding model, while a long
 * rambling story wants nothing special. This reads the request's *kind*.
 */
type Dispatch = "code" | "research" | "reasoning" | "general";

const CODE_REQUEST = /\b(code|coding|function|class|method|variable|compile|compiler|syntax|refactor|debug|bug|stack trace|exception|typescript|javascript|python|rust|golang|java|swift|kotlin|sql|html|css|react|next\.?js|vue|svelte|node|npm|yarn|docker|kubernetes|git|regex|api endpoint|unit test|null pointer|segfault|npm install|traceback)\b/i;

/* "Can you do a deep research on X" did not match this — the one word a
   research request is most likely to contain was missing from it, so the
   clearest possible ask fell through to generic reasoning. */
const RESEARCH_REQUEST = /\b(search|research|investigate|look ?up|look into|find out|deep ?dive|latest|current|today|this (?:week|month|year)|news|who is|what happened|according to|source|sources|cite|citation|price of|stock|weather|release date|is it true|fact ?check)\b/i;

/** Named so the status line can say what was engaged, in Navi's own words. */
const DISPATCH_LABEL: Record<Dispatch, string> = {
  code: "NaviSoul · code",
  research: "NaviSoul · research",
  reasoning: "NaviSoul · reasoning",
  general: "NaviSoul"
};

function dispatchFor(text: string, band: Effort, effort: EffortLevel): Dispatch {
  if (CODE_REQUEST.test(text)) return "code";
  if (RESEARCH_REQUEST.test(text)) return "research";
  if (band !== "normal" || effort === "high") return "reasoning";
  return "general";
}

/* Operations that only make sense performed on the picture itself. These are
   unambiguous: nobody says "upscale this" about the contents of a screenshot. */
const PICTURE_OPERATION = /\b(retouch|upscale|recolou?r|inpaint|outpaint|photoshop|crop|rotate|resize|blur|sharpen|brighten|darken|desaturate|touch\s?up|cut\s?out|remove the background)\b/i;

/* Verbs that mean "edit the picture" only when aimed at something pictorial.
   On their own they are the ordinary vocabulary of asking for help. */
const GENERIC_EDIT_VERB = /\b(edit|change|changing|remove|removing|delete|replace|swap|add|insert|enhance|restore|fix|correct|clean|update|adjust|make|turn|convert|put|move|extend|fill|mask|highlight|circle|annotate|colou?r|professional)\b/i;

/* What a generic verb has to be aimed at before it counts as an edit. */
const VISUAL_TARGET = /\b(background|foreground|lighting|shadows?|colou?rs?|contrast|saturation|brightness|hue|tint|sky|face|faces|hair|skin|eyes|smile|teeth|logo|watermark|border|frame|filter|resolution|aspect ratio|blemish|wrinkle|glare|reflection|in (?:the|this) (?:image|picture|photo|screenshot|shot)|of (?:the|this) (?:image|picture|photo))\b/i;

/* A request that opens as a question is asking about the picture, not asking
   for a new one. "Can you fix this" over a screenshot of a stack trace is the
   single most common thing anyone does with an attachment in a chat app. */
const ASKS_ABOUT_CONTENT = /^\s*(?:hey\s+|hi\s+|so\s+|ok(?:ay)?[,\s]+|please\s+)*(?:what|why|how|who|when|where|which|whats|what's|is|are|was|were|does|do|did|can you (?:tell|explain|read|see|help|figure)|could you (?:tell|explain|read)|explain|tell me|read|describe|summar|analy|review|check|look at|help me understand|any idea|do you (?:know|see)|i (?:dont|don't|do not) understand)\b/i;

/* Asking what something says or means, wherever it appears in the sentence.
   "Don't change anything, just tell me what's wrong" opens with a preservation
   phrase, so the opening-question check alone did not catch it — and it is
   about as clear a request for analysis as anyone writes. */
const WANTS_ANALYSIS = /\b(tell me|what'?s wrong|what is wrong|whats wrong|explain|describe|summar|translate|transcribe|analy[sz]e|what (?:it|this|that) says?|what does (?:it|this) say|read (?:it|this|the))\b/i;

function imageGenerationIntent(text: string, hasImageAttachment: boolean): boolean {
  const creationVerb = /\b(generate|create|make|draw|illustrate|render|design|produce)\b[\s\S]{0,90}\b(image|picture|photo|portrait|illustration|artwork|wallpaper|poster|logo|icon)\b/i;
  const visualFirst = /^\s*(?:(?:a|an|the|some|random)\s+)?(?:image|picture|photo|portrait|illustration|artwork|wallpaper|poster|logo|icon)\s+(?:of|showing|depicting|with)\b/i;
  const directDrawing = /\b(draw|illustrate|visualize|paint|sketch|render)\s+(?:me\s+)?\b/i;
  const explicitImageMode = /\b(text[- ]to[- ]image|image generation|generate an image|generate a picture|make me an image|make me a picture)\b/i;

  /* Editing an attached image used to trigger on any of roughly forty common
     verbs. "Can you fix this" under a screenshot of a stack trace matched
     `fix`, went to the image editor, and failed — as did "how do I make this
     work", "help me correct this", and "add error handling to this". Sending a
     screenshot and asking about it is the most common thing anyone does with
     an attachment, and it was the case most reliably broken.

     So a generic verb now has to be aimed at something pictorial, an opening
     question means the picture is the subject rather than the target, and the
     preservation phrasings only count alongside an actual edit instruction —
     "don't change anything, just tell me what's wrong" is not an edit. */
  const editAttached = hasImageAttachment && (
    PICTURE_OPERATION.test(text)
    || (!ASKS_ABOUT_CONTENT.test(text) && !WANTS_ANALYSIS.test(text) && GENERIC_EDIT_VERB.test(text) && (
      VISUAL_TARGET.test(text)
      || /\b(?:do\s?n[o\']?t|don\'t|never)\s+(?:change|alter|modify|touch|edit|move|remove)\b/i.test(text)
      || /\bkeep\s+.{1,40}?\s+(?:the\s+same|unchanged|as\s+is|intact)\b/i.test(text)
      || /\bwithout\s+(?:changing|altering|modifying|touching)\b/i.test(text)
    ))
  );

  return creationVerb.test(text) || visualFirst.test(text) || directDrawing.test(text) || editAttached || explicitImageMode.test(text);
}

function artifactIntent(text: string): boolean {
  return /\b(artifact|interactive|button|form|widget|calculator|dashboard|prototype|mini[- ]?app|tool|game|quiz|control|input|dropdown|toggle|slider)\b/i.test(text)
    || /\b(click|press|tap)\b[\s\S]{0,50}\b(work|working|respond|button|control)\b/i.test(text);
}

/**
 * Strip generated media out of the history before it goes back to a model.
 *
 * These payloads are megabytes of base64. Left in, every subsequent turn
 * re-uploads every clip and image the conversation has ever produced, which
 * costs the request budget and eventually exceeds it outright — the model
 * gains nothing from re-reading bytes it cannot listen to or look at.
 */
/**
 * How many recent messages keep their attachments in full.
 *
 * Uploaded files travel as base64 data URLs and were replayed on every
 * subsequent turn, forever. A chat with three photos in it re-sent all three
 * with every message — several megabytes of body per turn, which is both the
 * "that didn't go through" failure and a large part of why the app felt slow,
 * since those bytes are uploaded from a phone before a single token can be
 * generated.
 *
 * A window rather than only-the-latest, because "what about the top-left
 * corner?" is a normal follow-up and must still see the picture. Beyond it,
 * the attachment becomes a note: the model is told what was there rather than
 * being left to infer that a file it cannot see never existed.
 */
const ATTACHMENT_REPLAY_WINDOW = 4;

function redactStaleAttachments(messages: UIMessage[]): UIMessage[] {
  const cutoff = messages.length - ATTACHMENT_REPLAY_WINDOW;
  if (cutoff <= 0) return messages;

  return messages.map((message, index) => {
    if (index >= cutoff) return message;
    const parts = message.parts as Array<Record<string, unknown>>;
    if (!parts?.some((part) => part.type === "file")) return message;
    return {
      ...message,
      parts: parts.map((part) => {
        if (part.type !== "file") return part;
        const name = typeof part.filename === "string" ? part.filename : "a file";
        const kind = typeof part.mediaType === "string" && part.mediaType.startsWith("image/") ? "image" : "document";
        return { type: "text", text: `[An ${kind} (${name}) was attached earlier in this conversation. Ask the user to re-attach it if you need to look at it again.]` };
      })
    };
  }) as UIMessage[];
}

function redactGeneratedMedia(messages: UIMessage[]): UIMessage[] {
  return redactStaleAttachments(messages).map((message) => ({
    ...message,
    parts: message.parts
      /* Reasoning traces are provider-specific and not portable. An assistant
         turn recorded with one provider's `reasoning_content` is rejected
         outright by providers that do not accept the field —
         "property 'reasoning_content' is unsupported" — which turns one
         reasoning reply into a permanently broken conversation.

         Falling back across providers made this certain rather than likely,
         since the whole point is that turn two may go somewhere turn one did
         not. They are intermediate work in any case: the constitution forbids
         exposing them, and replaying them buys the model nothing. */
      .filter((part) => part.type !== "reasoning")
      .map((part) => part.type === "text"
      ? {
        ...part,
        text: part.text
          .replace(/```navi-image\s*[\s\S]*?```/gi, "[A raster image was generated in this earlier turn.]")
          .replace(/```navi-audio\s*[\s\S]*?```/gi, "[An audio clip was generated in this earlier turn.]")
      }
      : part)
  })) as UIMessage[];
}

/**
 * Effort is a per-message thoroughness dial. Each level is a genuinely
 * different instruction — and, in the router, a different model — not a
 * relabel of the same request. High also buys a self-verification pass.
 */
function effortInstruction(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Keep the response compact and direct. Answer in the fewest words that fully resolve the request. Avoid redundant framing, preambles, and summaries.";
    case "high":
      return "Work through the problem thoroughly: state assumptions explicitly, cover the main answer plus alternatives, edge cases, and trade-offs worth knowing. Before finishing, re-read the request to confirm every part of it was addressed, verify each factual or numeric claim, and correct anything that does not hold up. Length is acceptable; missed detail is not.";
    default:
      return "Lead with the direct answer, then include the detail needed to make it useful.";
  }
}

function effortFromBody(body: ChatRequestBody): EffortLevel {
  if (ALLOWED_EFFORTS.has(body.effort as EffortLevel)) return body.effort as EffortLevel;
  const retired = RETIRED_EFFORTS[String(body.effort ?? "")];
  if (retired) return retired;
  // Older clients send the three-way style instead.
  if (body.style === "concise") return "low";
  if (body.style === "detailed") return "high";
  return "medium";
}

/** Standing user context: who they are and how they want Navi to respond. */
function userContextBlock(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const input = value as UserContextInput;
  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 80) : "";
  const work = typeof input.work === "string" ? input.work.trim().slice(0, 120) : "";
  const instructions = typeof input.instructions === "string" ? input.instructions.trim().slice(0, 4_000) : "";
  if (!displayName && !work && !instructions) return "";
  return [
    "About the user (persistent profile they set themselves):",
    displayName ? `- They want to be addressed as ${displayName}.` : "",
    work ? `- Their work: ${work}.` : "",
    instructions ? `- Their standing instructions for every conversation:\n${instructions}` : ""
  ].filter(Boolean).join("\n");
}

function artifactInstruction(requested: boolean): string {
  const contract = [
    "NaviOS artifacts are real interactive documents rendered in an isolated browser sandbox.",
    "Emit them as a fenced navi-artifact JSON block containing id, title, kind, html or svg, and height.",
    "For documents, reports, and printable pages (including anything the user wants as a PDF), use kind html with a complete styled document in the html field; the viewer offers export from there.",
    "For interactive HTML, include all markup, CSS, and JavaScript inside the html field. Buttons, inputs, forms, tabs, counters, calculators, and other controls must actually work.",
    "Use inline script with addEventListener. Do not use onclick or other on* attributes because those are removed by the sanitizer.",
    "Never hardcode a page background or text colour. The sandbox already sets one that matches the user's theme, and a white background renders as a glaring slab in dark mode. Where you need colours, use the supplied variables: var(--navi-bg), var(--navi-fg), var(--navi-muted), var(--navi-border), var(--navi-surface), var(--navi-accent).",
    "Always use the canonical fence exactly: three backticks followed by navi-artifact. Fences labelled artifact, react-component, or anything else are not the contract.",
    "Do not use remote scripts, external stylesheets, network requests, external images, navigation, secrets, or parent-window access.",
    "The sandbox supports local state, DOM updates, validation, calculations, and clipboard actions."
  ].join(" ");
  return requested
    ? `${contract} The user is requesting or repairing an interactive result. Produce the complete working artifact now. Do not claim artifacts are static or that controls cannot be pressed. If an earlier artifact was unresponsive, replace it with a corrected functional artifact.`
    : contract;
}

/**
 * Chat mode, stated rather than left as the absence of Code mode.
 *
 * Chat used to be defined by what it was not, so the two modes differed only
 * in routing — invisible from the outside. Saying what Chat is for makes the
 * segmented control mean something on every turn, not only on the turns the
 * dispatcher happens to label.
 */
function chatModeInstruction(): string {
  return [
    "You are NaviSoul working in NaviOS Chat.",
    "Answer in prose. Explain in plain language first, and reach for a code block only when the user asked for code or when nothing else can express the answer.",
    "Prefer the shortest complete answer. Where a question has a short answer and a long one, give the short one and offer to go further.",
    "Engage with what was actually asked rather than the general topic around it, and pick up the thread of the conversation instead of restarting it each turn.",
    "When a request would be better served in Code mode — a repository, a stack trace, a build — say so in one line and answer anyway."
  ].join(" ");
}

/** The behavioural difference between the Chat and Code models lives here. */
function codeModeInstruction(): string {
  return [
    "You are NaviSoul working in Code mode.",
    "Prefer working code over prose about code: give complete, runnable snippets with the imports they need, and state the language and file path when it matters.",
    "When debugging, reason from the actual error text and the code shown; name the root cause before proposing the fix, and keep the fix minimal.",
    "Match the conventions of any code the user shows you. Flag breaking changes, missing tests, and security problems even when unasked.",
    "If a request is ambiguous between several implementations, pick the most conventional one and say what you assumed.",
    "When repository or deployment tools are available, read the real file, the real CI log, or the real build log before diagnosing. Never describe code you have not read or guess at an error you could have fetched.",
    "Those tools are read-only: you can inspect repositories and deployments but cannot commit, merge, or deploy. If a task needs a write, give the exact change and say it has to be applied by hand."
  ].join(" ");
}

function systemPrompt(options: {
  effort: EffortLevel;
  /** The dispatch lane, which decides how the answer is shaped. */
  mode: "chat" | "code";
  /** The product mode the user chose. Chat mode still answers code questions. */
  productMode: NaviMode;
  tools: ToolPolicy;
  artifactRequested: boolean;
  /** The request itself, read only to decide which optional blocks load. */
  request?: string;
  threadSummary?: string;
  mcpContext?: string;
  toolNames?: string[];
  userContext?: string;
  memoryContext?: string;
  playbookContext?: string;
  /** The request asked Navi to learn something, so it may offer a capability. */
  capabilityRequested?: boolean;
  /** Repository files fetched before generating, when the repo was knowable. */
  retrieved?: string;
  /** Attached documents, extracted as text rather than shown as pages. */
  documents?: string;
  /** The plan Soul made for this request, and what the answer must satisfy. */
  constraints?: string;
}): string {
  const { effort, mode, tools, artifactRequested, request = "", threadSummary, mcpContext, toolNames = [], userContext, memoryContext, playbookContext, constraints, retrieved, documents, capabilityRequested = false, productMode } = options;
  /* Ordered stable-first, volatile-last, and that ordering is load-bearing.
     The metered lane bills a cached prompt prefix at roughly one fiftieth of an
     uncached one, and the cache matches on an exact byte prefix — so a single
     per-request string placed early invalidates everything after it and turns a
     cheap request into a full-price one.

     `constraints` is the clearest example: it changes every single turn, and it
     used to sit fifth, ahead of the two largest stable blocks in the prompt, so
     nothing before the end of them could ever cache. It now sits with the other
     per-request material at the bottom. Do not move anything up this list
     without checking the hit rate. */
  return [
    /* Base plus mode body: one constant string per mode, assembled from parts
       rather than branched inside. Roughly 500 tokens where the old prompt
       spent 3,000, most of which was a description of the app that only
       mattered when someone asked about the app. */
    stablePrefix(productMode === "code" ? "code" : "chat"),
    /* Loaded when the request is actually about the product. It is the single
       largest block available and answers exactly one kind of question. */
    needsAppKnowledge(request) ? APP_KNOWLEDGE : "",
    /* The standing brief: what this project is for, the bar for an answer,
       and the specific mistakes already made that must not recur. Carried
       whenever the turn touches the project, its memory, or its tools. */
    needsMission(request) ? NAVI_MISSION : "",
    /* How to move around its own models: which engine suits which work, when a
       second is worth its latency, and how to reconcile what comes back.
       Without this NaviSoul behaved like one model with tools and described
       its own routing from invention. */
    needsOrchestrationKnowledge(request, effort) ? ORCHESTRATION_KNOWLEDGE : "",
    /* Keyed to the mode the user actually chose, not to how the dispatcher
       classified this message. Keying it to dispatch meant that picking Code
       and then asking something the classifier read as ordinary produced a
       reply identical to Chat's — which is precisely the "switching modes
       doesn't feel different" complaint. The switch is an instruction from
       the user; it applies until they move it back. */
    productMode === "code" ? codeModeInstruction() : chatModeInstruction(),
    playbookContext || "",
    effortInstruction(effort),
    userContext || "",
    toolNames.length
      ? `You can call these tools and their results are real: ${toolNames.join(", ")}. Call one whenever it would answer better than recalling — anything current, factual, personal, or specific to the user's own data. Never do arithmetic, unit conversion, date maths, or counting in your head when a tool will do it exactly; approximating those is the most common way you are wrong. Prefer searching and reading a source over answering from memory, and cite the URLs you actually read.`
      : "You have no callable tools in this request. Answer from your own knowledge, and say plainly when something needs live data you cannot reach.",
    toolNames.includes("web_search")
      ? ""
      : tools.web
        ? "Web search is switched on but unavailable on this route, so you cannot browse. Say so rather than implying you looked something up."
        : "You cannot browse the web in this request.",
    /* The capability is the app's own now, not the route's. It used to be
       described as available "only when the selected route actually supplies
       it", which made a core ability hostage to whichever provider answered. */
    tools.code && toolNames.includes("run_javascript") ? executionInstruction() : "",
    tools.artifacts ? artifactInstruction(artifactRequested) : "",
    capabilityRequested ? capabilityInstruction() : "",
    memoryContext || "",
    /* With the other per-request material, never above the stable prefix. File
       contents are the most volatile thing in the prompt — they differ on every
       question — so placing them early would invalidate the cached prefix for
       the metered lane on every single turn. */
    retrieved || "",
    documents || "",
    threadSummary ? `Compact summary and active project context:\n${threadSummary.slice(0, 8_000)}` : "",
    mcpContext ? `Connected MCP resource metadata:\n${mcpContext}` : "",
    /* Last, because it is the most volatile thing here and the most recent
       thing read before the request itself. Both reasons point the same way. */
    constraints || ""
  ].filter(Boolean).join("\n\n");
}

/* An explicit ask to keep something for later. Deliberately narrow: the
   contract below is only useful when a block is actually wanted, and carrying
   it on every request would spend the prompt budget on nothing. */
const CAPABILITY_REQUEST = /\b(?:add|learn|remember|save|install|create|build|give you|teach you|pick up)\b[\s\S]{0,60}\b(?:capabilit(?:y|ies)|skill|skills|playbook|playbooks|ability|method|workflow|routine|instruction set)\b|\b(?:capabilit(?:y|ies)|skill|skills|playbook)\b[\s\S]{0,40}\b(?:for (?:future|next time)|from now on|permanently|so you (?:know|remember|can))\b|\bfrom now on\b[\s\S]{0,80}\b(?:always|remember|use this)\b|\b(?:find|search for|search the web for|scour(?: the web)? for|look for|go get)\b[\s\S]{0,50}\b(?:skills?|capabilit(?:y|ies)|playbooks?)\b/i;

function capabilityInstruction(): string {
  return [
    "## Adding a capability",
    "",
    "When the user asks you to learn, add, remember, or install a capability, skill, method, or way of working — or gives you instructions they want kept for future conversations — reply with a short sentence and then a `navi-capability` fenced block containing a SKILL.md document:",
    "",
    "```navi-capability",
    "---",
    "name: A short title, five words at most",
    "description: One sentence on what it is for. This is matched against future requests, so use the words someone would actually type.",
    "---",
    "",
    "# The title again",
    "",
    "Numbered steps giving the method, in the order it should be carried out. Then a short Guidelines section for the non-obvious traps.",
    "```",
    "",
    "Rules for this block:",
    "- Write a method with an order of operations, not a description of a topic. \"Be careful about X\" changes nothing; \"check A, then B, then C, and here is why that order\" changes the answer.",
    "- Emit at most one block per reply, and only when actually asked. Never volunteer one.",
    "- If web search is available and the user asked you to find an existing skill, search first and base the block on what you found, naming the source in your sentence.",
    "- Do not claim it has been added. The user installs it by tapping the card; say what it would do, not that it is done.",
    "- If you cannot write something genuinely useful, say so instead of emitting a thin block."
  ].join("\n");
}

/**
 * Turn any failure into a sentence the user can act on.
 *
 * The original is logged server-side and never rendered. A provider echoed its
 * own retirement notice into a chat bubble — naming a third party, leaking an
 * implementation detail, and telling the user nothing they could act on.
 * Passing provider text through was a diagnostic expedient that had no
 * business surviving the diagnosis.
 */
/**
 * What a person reads when every lane has already failed.
 *
 * By the time this runs the request has been tried on each configured route
 * and none of them answered — silent failover happens upstream, so anything
 * reaching here is the end of the line rather than a first attempt.
 *
 * Three rules the copy follows. It names no provider, because the user talks
 * to NaviSoul and NaviSoul has no vendors. It does not apologise, because an
 * apology is not information and reads as evasion when repeated. And it says
 * what to do next, because the only useful part of an error is the next step.
 *
 * Every original message goes to the server log, where the detail belongs.
 */
function streamError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error("NaviSoul stream error:", error);
  const lower = message.toLowerCase();
  if (lower.includes("image providers") || lower.includes("image-generation provider")) return "Image generation is unavailable right now. Tap to retry in a moment.";
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) return "Too many requests just now. Tap to retry in a moment.";
  if (lower.includes("api_key") || lower.includes("api key") || lower.includes("credential") || lower.includes("401") || lower.includes("403") || lower.includes("forbidden")) {
    return "NaviSoul has no working credential to answer with. Add one in Settings.";
  }
  if (lower.includes("timeout") || lower.includes("aborted")) return "That took too long. Tap to retry, or lower the effort.";
  return "That didn't go through. Tap to retry.";
}

function statusChunk(status: NaviStreamStatus) {
  return { type: "data-status", data: status, transient: true } as any;
}

/**
 * Reject a request in the format the client can actually read.
 *
 * A plain JSON body is not a UI message stream, so the AI SDK cannot parse it
 * and falls back to its own "An error occurred." That hid every real reason —
 * rate limits, oversized conversations, unconfigured providers — behind three
 * useless words. Returning the refusal *through* the stream means the actual
 * sentence reaches the person who needs to act on it.
 */
function refuse(message: string, headers?: Record<string, string>): Response {
  const stream = createUIMessageStream({
    onError: () => message,
    execute() {
      throw new Error(message);
    }
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate", ...headers }
  });
}

/**
 * Charge a metered response to the monthly ledger.
 *
 * Deliberately fire-and-forget: usage settles after the answer has streamed,
 * and nobody should wait on bookkeeping. The cache-hit and cache-miss counts
 * live in provider metadata rather than the SDK's normalised usage object, so
 * both are merged before reading — missing them entirely would price a cheap
 * cached request as a full miss, which errs expensive and therefore safe.
 */
async function meterSpend(result: { usage: PromiseLike<unknown>; providerMetadata?: PromiseLike<unknown> }, model: string): Promise<void> {
  try {
    const [usage, metadata] = await Promise.all([
      Promise.resolve(result.usage),
      Promise.resolve(result.providerMetadata ?? null)
    ]);
    const extras = metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).deepseek
      : null;
    const merged = {
      ...(usage && typeof usage === "object" ? usage as Record<string, unknown> : {}),
      ...(extras && typeof extras === "object" ? extras as Record<string, unknown> : {})
    };
    const parsed = readUsage(merged);
    if (!parsed) return;
    const tier = /pro/i.test(model) ? "pro" : "flash";
    console.info("NaviSoul metered request", { model, ...parsed });
    await recordSpend(parsed, tier);
  } catch (error) {
    console.error("NaviSoul could not meter a request:", error);
  }
}

/**
 * Extract text from every attached document that has any.
 *
 * A file that yields nothing is left alone rather than dropped: it goes to the
 * model as it always did, which for a scan is the correct path rather than a
 * degraded one.
 */
async function extractDocuments(messages: UIMessage[]): Promise<Array<{ name: string; block: string }>> {
  const parts = fileParts(messages.slice(-2));
  const out: Array<{ name: string; block: string }> = [];

  for (const part of parts) {
    const url = part.url ?? "";
    if (!url.startsWith("data:")) continue;
    const name = part.filename ?? "document";

    try {
      if (part.mediaType === "application/pdf") {
        const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (char) => char.charCodeAt(0));
        const extracted = await extractPdfText(bytes);
        if (extracted) out.push({ name, block: documentBlock(name, extracted) });
        continue;
      }
      if (part.mediaType === "text/csv") {
        const text = atob(url.slice(url.indexOf(",") + 1));
        const table = csvToMarkdown(text);
        if (table.text) out.push({ name, block: documentBlock(name, table) });
      }
    } catch (error) {
      console.warn("NaviSoul could not read an attached document:", error);
    }
  }

  return out;
}

function documentsBlock(documents: Array<{ name: string; block: string }>): string {
  return [
    "## Attached documents, read as text",
    "",
    "This is the document's own text, not a picture of it. Reason from it directly.",
    "",
    ...documents.map((document) => document.block)
  ].join("\n");
}

function splitLargePayload(text: string, size = 32_000): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}


/**
 * Chat and Code are the two headline models; the swarms sit behind them as an
 * escalation tier. A request only escalates when both the user's effort dial
 * and the request's own complexity justify the extra latency, and never for
 * file inputs (the swarms are text-only).
 */
function resolveHeadlinePreset(options: {
  preset: ModelPreset;
  complexityBand: Effort;
  effort: EffortLevel;
  providerCount: number;
  hasFiles: boolean;
  /** True when the request wants live sources and the app can actually fetch them. */
  needsLiveSources: boolean;
}): ModelPreset {
  const { preset, complexityBand, effort, providerCount, hasFiles, needsLiveSources } = options;
  if (providerCount < 2 || hasFiles) return preset;
  /* The swarms deliberate; they do not browse. runComposite gets a tool
     *policy* but never callable tools, so escalating a research request into
     one silently removes the web access that made it a research request —
     High effort plus Research mode was the one combination guaranteed to
     answer from memory alone. For anything wanting live sources the direct
     route is strictly better: it can actually search. */
  if (needsLiveSources) return preset;
  // Escalation costs real latency, so it needs both signals: the user asked
  // for depth *and* the request itself is genuinely hard.
  if (effort !== "high" || complexityBand === "normal") return preset;
  if (preset === "navi-soul" || preset === "auto") return "navi-sol";
  // Fable is the long-horizon build swarm — the right escalation for code.
  if (preset === "navi-code") return "navi-fable";
  return preset;
}

export async function POST(request: Request): Promise<Response> {
  /* Every budget in this handler is measured from here, so a stage that starts
     late gets the time that is actually left rather than the time it wanted. */
  const requestStartedAt = Date.now();
  /* Authorization refusals are JSON too, and the client renders any
     non-stream body as a bare "An error occurred." Re-emit the real sentence
     through the stream so a signed-out session or a stale tab says so. */
  const authorizationError = await authorizeApiMutation(request);
  if (authorizationError) {
    const reason = await authorizationError.json().catch(() => null) as { error?: string } | null;
    return refuse(reason?.error === "Sign in to continue."
      ? "Your session expired. Reload the app to sign back in."
      : reason?.error || "NaviSoul could not authorize this request.");
  }
  if (isRateLimited(clientIdentifier(request))) return refuse("You are sending messages faster than NaviSoul can answer them. Wait a few seconds and try again.", { "Retry-After": "30" });

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return refuse("NaviSoul could not read that request. Reload the app and try again.");
  }

  /* Read inside the request scope. `cookies()` throws once the request closes,
     and the stream callback below runs after that — so resolving it lazily
     inside the callback would fail for every signed-in user. */
  const userGithubToken = await readGithubToken();
  /* Same scope rule, and one extra reason: this trades the stored refresh token
     for an access token over the network, so it must not be deferred into the
     stream callback where a failure would surface as a dead tool rather than as
     a disconnected account. */
  const userGoogleToken = await googleAccessToken();
  /* Read in request scope for the same reason: `cookies()` throws once the
     request closes, and both the recall read and the extraction write happen
     inside the stream callback that runs after that. */
  const clerkToken = getRequestClerkSessionToken(request);
  const clerkUserId = clerkToken ? await getRequestClerkUserId(request) : null;

  if (!Array.isArray(body.messages) || body.messages.length === 0) return refuse("There was no message to send.");
  if (body.messages.length > MAX_MESSAGES) return refuse(`This conversation is too long to continue — over ${MAX_MESSAGES} messages. Start a new chat; NaviSoul will still remember the important parts.`);
  if (JSON.stringify(body.messages).length > MAX_SERIALIZED_CHARACTERS) return refuse("This conversation and its attachments are too large to send. Start a new chat, or remove an attachment.");

  const messages = body.messages.slice(-MAX_MESSAGES);
  const fileError = validateFiles(messages);
  if (fileError) return refuse(fileError);

  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const lastUserText = textOf(lastUserMessage);
  if (!lastUserText) return refuse("Add a short description of what you want NaviSoul to do with this.");

  const currentImageAttachments = imageAttachments(lastUserMessage);
  const imageRequested = imageGenerationIntent(lastUserText, currentImageAttachments.length > 0);
  /* The client sends a mode. A route pin is diagnostics only, and a v4.2.0
     client that has not reloaded still sends `preset` — all three collapse
     here so nothing downstream has to know which arrived. */
  const mode: NaviMode = body.mode === "code" ? "code" : body.mode === "chat" ? "chat" : LEGACY_PRESET_MODE[String(body.preset ?? "")] ?? "chat";
  const preset = normalizePreset(body.routeOverride ?? (mode === "code" ? "navi-code" : "navi-soul"));
  const effortLevel = effortFromBody(body);
  // The swarm pipeline still thinks in the old three-way style; derive it.
  const style = body.style && ALLOWED_STYLES.has(body.style)
    ? body.style
    : effortLevel === "low" ? "concise" : effortLevel === "medium" ? "balanced" : "detailed";
  const userContext = userContextBlock(body.userContext);
  const tools: ToolPolicy = {
    web: body.tools?.web === true,
    code: body.tools?.code === true,
    artifacts: body.tools?.artifacts !== false
  };
  const connectorAccessMode = normalizeConnectorAccessMode(body.connectorAccessMode);
  const projectSummary = projectContextSummary(body.projectContext);
  /* Recall is computed on the device from chats the server never sees, so it
     arrives as text and is bounded here like any other client input. */
  const recalledContext = typeof body.memory === "string" ? body.memory.trim().slice(0, 3_000) : "";
  /* Whether this turn may add to memory. The client decides, because the two
     things that forbid it — the memory switch and incognito — are both its
     state, and an empty `memory` string means nothing was recalled rather than
     that memory is off. */
  const mayRemember = body.remember === true;

  /* Facts outrank recalled passages, and are placed before them: a passage is
     evidence that something was once said, while a fact is a standing
     statement about the person. Read server-side because that is where the
     credential lives — the client never sees the store. */
  /* Facts and learned skills are independent reads of the same store; one
     request each, in parallel, and either failing costs only its own block. */
  const [storedFacts, storedSkills] = await Promise.all([
    mayRemember && clerkToken && factsConfigured() ? listFacts(clerkToken) : Promise.resolve([]),
    mayRemember && clerkToken && learnedSkillsConfigured() ? listLearnedSkills(clerkToken) : Promise.resolve([])
  ]);
  const rememberedBlock = factsBlock(storedFacts);
  const skillsContext = learnedSkillsBlock(storedSkills);
  /* Told the mechanism exists, not just handed its output.
   *
   * Rendering facts alone left the model with no idea it had a memory at all:
   * asked "add that to your memory" it answered that it had no way to store
   * anything across sessions — denying a capability it has — and a turn earlier
   * it said it had "noted" a preference, claiming a save it could not make.
   * Both are the same gap. It cannot describe a system nothing describes to it. */
  const memoryCapability = mayRemember && factsConfigured()
    ? [
      "You have a durable memory. Standing facts about this user — how they work, what they use, what they always want — are extracted and stored automatically, and are listed under Settings → Privacy where the user can remove any of them.",
      "So: if asked to remember something durable, confirm plainly that you will. Never say you cannot store anything between conversations, and never claim to have saved a specific item, since the extraction happens outside this reply and you cannot see its result.",
      "The exception is skills: when the learn_skill tool is available and the user asks you to learn or keep a technique, workflow, or the contents of a link, call it — its result tells you whether the save really happened, and only then may you confirm it."
    ].join("\n")
    : "";

  const memoryContext = [memoryCapability, rememberedBlock, skillsContext, recalledContext].filter(Boolean).join("\n\n");
  const playbookContext = typeof body.playbook === "string" ? body.playbook.trim().slice(0, 4_500) : "";
  const threadSummary = [
    typeof body.threadSummary === "string" ? body.threadSummary.trim().slice(0, 5_000) : "",
    projectSummary
  ].filter(Boolean).join("\n\n").slice(0, 8_000);
  const availability = getProviderAvailability();
  const providerCount = Object.values(availability).filter(Boolean).length;
  const hasFiles = fileParts(messages).length > 0;
  const effort = complexity(lastUserText);
  /* Sound is checked after images so "make me a picture of a bell ringing"
     stays a picture — the image intent is the more specific match. */
  const audioRequested = !imageRequested && audioGenerationIntent(lastUserText);
  const capabilityRequested = CAPABILITY_REQUEST.test(lastUserText);
  const artifactRequested = !imageRequested && !audioRequested && tools.artifacts && artifactIntent(lastUserText);
  /* Soul is the architect: it reads the request and routes to whichever
     engine leads at that job, so nothing has to be chosen by hand. */
  const origin = new URL(request.url).origin;
  /* Soul plans before it answers. The heuristic plan is the primary path and
     is correct for most requests; the architect is consulted only when the
     patterns could plausibly be wrong and the request is worth the latency.
     Planning can never fail a request — every path here falls back. */
  const basePlan = preset === "navi-code"
    ? { ...heuristicPlan({ text: lastUserText, hasFiles, imageRequested, audioRequested, tools, effort: effortLevel }), lane: "code" as const }
    : heuristicPlan({ text: lastUserText, hasFiles, imageRequested, audioRequested, tools, effort: effortLevel });
  const plan = shouldConsultArchitect({ text: lastUserText, plan: basePlan, effort: effortLevel })
    ? await architectPlan({ text: lastUserText, fallback: basePlan, origin, effort: effortLevel, abortSignal: request.signal })
    : basePlan;
  const dispatch: Dispatch = plan.lane === "code" ? "code"
    : plan.lane === "research" ? "research"
      : plan.lane === "reasoning" ? "reasoning"
        : "general";
  const dispatchedPreset: ModelPreset = preset === "navi-soul" && dispatch === "code" ? "navi-code" : preset;
  const resolvedPreset = resolveHeadlinePreset({
    preset: dispatchedPreset,
    complexityBand: effort,
    effort: effortLevel,
    providerCount,
    hasFiles,
    needsLiveSources: dispatch === "research" && tools.web && hasWebSearch()
  });

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: streamError,
    async execute({ writer }) {
      writer.write(statusChunk({ stage: "gather", detail: imageRequested ? "Preparing the real image-generation pipeline." : projectSummary ? "Preparing project context and enabled capabilities." : "Preparing context and enabled capabilities." }));

      if (imageRequested) {
        writer.write(statusChunk({ stage: "plan", detail: currentImageAttachments.length ? "Preparing the source image and edit instructions." : "Composing the image request." }));
        writer.write(statusChunk({ stage: "draft", detail: "Generating a high-quality raster image." }));
        const payload = await generateNaviImage({
          prompt: projectSummary ? `${projectSummary}\n\nCurrent image request:\n${lastUserText}` : lastUserText,
          attachments: currentImageAttachments,
          abortSignal: request.signal
        });
        writer.write(statusChunk({ stage: "verify", detail: "Validating the generated image and display format." }));
        const responseText = `\`\`\`navi-image\n${JSON.stringify(payload)}\n\`\`\``;
        const textId = generateId();
        writer.write(statusChunk({ stage: "stream", detail: "Displaying the generated image." }));
        writer.write({ type: "text-start", id: textId });
        for (const chunk of splitLargePayload(responseText)) writer.write({ type: "text-delta", id: textId, delta: chunk });
        writer.write({ type: "text-end", id: textId });
        writer.write(statusChunk({ stage: "complete", detail: "Image complete." }));
        return;
      }

      if (audioRequested) {
        const kind = classifyAudioRequest(lastUserText);
        writer.write(statusChunk({
          stage: "plan",
          detail: kind === "speech"
            ? "Preparing the words to speak."
            : kind === "effect"
              ? "Shaping a short sound cue."
              : "Composing the music request."
        }));
        writer.write(statusChunk({ stage: "draft", detail: kind === "speech" ? "Generating speech." : "Generating audio." }));
        const payload = await generateNaviAudio({ prompt: lastUserText, abortSignal: request.signal });
        writer.write(statusChunk({ stage: "verify", detail: "Validating the generated clip." }));
        const responseText = `\`\`\`navi-audio\n${JSON.stringify(payload)}\n\`\`\``;
        const audioTextId = generateId();
        writer.write(statusChunk({ stage: "stream", detail: "Delivering the clip." }));
        writer.write({ type: "text-start", id: audioTextId });
        for (const chunk of splitLargePayload(responseText)) writer.write({ type: "text-delta", id: audioTextId, delta: chunk });
        writer.write({ type: "text-end", id: audioTextId });
        writer.write(statusChunk({ stage: "complete", detail: "Audio complete." }));
        return;
      }

      const allowedConnectorIds = connectorAccessMode === "ask" ? [] : body.connectedMcpServers;
      const connectorIds = Array.isArray(allowedConnectorIds) ? allowedConnectorIds : [];
      // Metadata tells the model what exists; the tool set lets it actually act.
      // Listing resources without callable tools was the whole gap here.
      // A tool call stalls the stream with nothing on screen unless the work
      // names itself, which reads as the app having hung.
      const announce = (label: string) => writer.write(statusChunk({ stage: "gather", detail: `${label}…` }));
      const [mcpContext, mcpTools] = connectorIds.length
        ? await Promise.all([
          gatherMcpMetadata(connectorIds, request.signal),
          buildMcpTools(connectorIds, request.signal, announce)
        ])
        : ["", {} as Awaited<ReturnType<typeof buildMcpTools>>];
      // Clock and page reading need no configuration, so they are always on;
      // search joins them only when a provider key is present.
      /* One registry decides what NaviSoul can do this turn, rather than five
         builders assembled here with five separate ideas of when they apply.
         It also enforces the ceiling on how many tools go out — past roughly a
         dozen, selection accuracy falls and every turn pays the schema cost of
         the ones the model will not call. */
      const availableTools = buildToolset({
        mode,
        policy: tools,
        githubToken: userGithubToken,
        googleAccessToken: userGoogleToken ?? undefined,
        /* Lets the repository group be offered when the turn is about repos or
           deployments, rather than being trimmed off the end of the cap. */
        request: lastUserText,
        githubWritesEnabled: githubWritesEnabled(),
        /* Lets learn_skill exist when there is a signed-in person to learn for. */
        clerkToken: mayRemember ? clerkToken : undefined,
        clerkUserId: mayRemember ? clerkUserId ?? undefined : undefined,
        /* Connectors the user typed in on the device. Access mode governs them
           exactly as it governs registry MCP servers. */
        customConnectors: connectorAccessMode === "ask" ? [] : parseCustomConnectors(body.customConnectors),
        signal: request.signal,
        /* Python runs on a Node route because the sandbox SDK cannot run on
           Edge. The origin lets the tool reach it; the cookie makes sure that
           route sees the same signed-in user this one did. */
        origin,
        cookie: request.headers.get("cookie") ?? undefined,
        onActivity: announce,
        mcpTools
      });
      /* Retrieval before generation. A mid-tier model handed the exact three
         relevant files beats a frontier model handed the wrong ones, and the
         read tools alone do not close that gap — a weaker model answers from
         the shape of the question rather than going to look.

         Only when the repository is unambiguous. Guessing one and silently
         loading the wrong codebase is far worse than not guessing: the tools
         still work, and the model asks for what it needs. */
      const repoRef = userGithubToken && mode === "code" ? detectRepo(lastUserText) : null;
      const retrieval = repoRef
        ? await retrieveFiles({ token: userGithubToken as string, repo: repoRef, request: lastUserText, signal: request.signal }).catch(() => null)
        : null;
      if (retrieval) {
        writer.write(statusChunk({
          stage: "gather",
          detail: `Read ${retrieval.paths.length} file${retrieval.paths.length === 1 ? "" : "s"} from the repository.`
        }));
      }

      /* Documents are read as documents, not looked at as pictures. Vision on a
         rendered page loses the things that make a document one: a table's
         column alignment becomes a guess, two columns interleave into nonsense,
         and a long contract exceeds what any vision pass attends to. The
         answers come back confident and wrong.

         Vision stays as the fallback for scans with no text layer, where a
         picture genuinely is all there is. */
      const documents = await extractDocuments(messages);
      if (documents.length) {
        writer.write(statusChunk({
          stage: "gather",
          detail: `Read ${documents.length} document${documents.length === 1 ? "" : "s"} as text.`
        }));
      }

      const modelMessages = await convertToModelMessages(redactGeneratedMedia(messages));

      if (resolvedPreset === "navi-fable" || resolvedPreset === "navi-sol") {
        const swarmProfile: SwarmPreset = resolvedPreset;
        writer.write(statusChunk({
          stage: "plan",
          detail: swarmProfile === "navi-fable"
            ? "Planning staged long-horizon work."
            : "Planning independent parallel workstreams."
        }));
        /* Opened before the swarm runs, not after it finishes. The answer now
           streams from its first token while the council checks it in the
           background, so there is no completed text to pace out — the cadence
           is the model's own. */
        const textId = generateId();
        writer.write({ type: "text-start", id: textId });
        await runComposite({
          profile: swarmProfile,
          messages: modelMessages,
          requestText: lastUserText,
          effort,
          origin,
          style,
          tools,
          artifactRequested,
          // The swarm prompt builder has no user-context slot; ride the summary.
          threadSummary: [userContext, threadSummary].filter(Boolean).join("\n\n").slice(0, 8_000),
          mcpContext,
          onStage: (status) => writer.write(statusChunk(status)),
          onDelta: (delta) => writer.write({ type: "text-delta", id: textId, delta }),
          abortSignal: request.signal
        });
        writer.write({ type: "text-end", id: textId });
        writer.write(statusChunk({ stage: "complete", detail: "Response complete." }));
        return;
      }

      const complexRoute = effortLevel === "high" || (effortLevel === "medium" && effort !== "normal");

      const lane = selectLane({
        mode,
        effort: effortLevel,
        complex: complexRoute,
        hasFiles,
        longContext: modelMessages.length > LONG_CONTEXT_TURNS
      });

      /* Warm the free-model catalogue for the next request. Not awaited: a
         catalogue lookup must never sit between a person pressing send and the
         first token arriving. */
      refreshFreeModels(request.signal);

      /* The one place the app is allowed to spend money, and it asks
         permission first. `readSpend` treats an unreadable ledger as exhausted,
         so a storage outage degrades to the free routes rather than to
         unlimited billing. */
      const spendStore = getSpendStore();
      const meteredAllowed = meteredLaneEnabled(spendStore)
        && (await readSpend().then((snapshot) => snapshot.state === "ok").catch(() => false));

      const generalRoute = selectDirectRoute({
        preset: resolvedPreset,
        availability,
        hasFiles,
        tools,
        // The effort dial is a promise of thoroughness, so High buys the
        // stronger route even when the request itself reads as simple — and
        // Low keeps the fast route even when it reads as hard.
        complex: complexRoute
      });

      /* A pinned diagnostic route is an explicit instruction and outranks the
         lane; everything else lets the lane decide, falling back to the general
         selector whenever the lane has no provider configured. */
      const pinned = resolvedPreset !== "navi-soul" && resolvedPreset !== "navi-code";
      const route = pinned
        ? generalRoute
        : routeForLane({
          lane,
          availability,
          tools,
          hasFiles,
          discovered: lane === 4 ? cachedRoute("coding") : null,
          meteredAllowed
        }) ?? generalRoute;
      /* Auto-routing has to be visible or it is a black box: when it picks
         badly there is otherwise no way to tell that it did. */
      /* The plan, shown rather than only acted on. NaviSoul has been making one
         for a while, but it lived entirely inside the request — so the only
         moment the user could correct a misread of their intent was after the
         work was already done. Correcting a plan is far cheaper than
         correcting an answer. */
      /* `plan.steps`, not `plan.constraints`. The latter also carries this
         app's fixed build rules, which are instructions to a model rather than
         a plan — on screen they told someone who asked to list their
         repositories that the reply would be deployable to Vercel as-is. */
      if (plan.steps.length > 1) {
        writer.write({
          type: "data-plan",
          data: { summary: plan.summary, steps: plan.steps.map((text) => ({ text, done: false })) }
        } as never);
      }
      writer.write(statusChunk({ stage: "stream", detail: artifactRequested ? "Building the interactive artifact." : `${plan.summary}` }));
      /* Whether tools can be sent is a fact about the chosen model, and lives
         beside the route table that knows which model that is. Asking the
         provider instead is what sent a tools array to a model that rejects
         one and failed every request that had web search switched on. */
      const toolNames = routeToolCallingSupport(route) === "custom" ? Object.keys(availableTools) : [];
      if (toolNames.length) {
        writer.write(statusChunk({ stage: "gather", detail: `${toolNames.length} tool${toolNames.length === 1 ? "" : "s"} available.` }));
      }
      /* Try the chosen route, then a route on a *different* provider if it
         fails before producing anything. A 403 from one provider took the
         whole app down while four other configured providers sat idle — for a
         system whose premise is several free tiers, betting the request on one
         of them is the wrong shape.

         The attempt only counts as recoverable while nothing has reached the
         screen. Once text is streaming, a failure is reported rather than
         retried: restarting mid-answer would replay a partial reply. */
      /* A long conversation is compacted rather than routed away from the best
         engine — which is exactly when the best engine is most wanted.
         Summarise the older turns, keep the recent ones verbatim.

         Per attempt, because the budget is a property of the model: a fallback
         lane can have a far smaller window than the primary, and compacting to
         the primary's budget would hand the fallback an input it cannot take.
         Results are memoised by budget so switching lanes does not pay for the
         same summary twice.

         `compactForBudget` returns the messages unchanged on any failure, so a
         summariser that is down costs a longer prompt, never the request. */
      /* Extraction runs beside the answer rather than after it. It reads only
         the question, so it has no reason to wait for the reply — and waiting
         would put a model call between the user and their last token. Nothing
         downstream awaits this: a failure to remember must never delay or fail
         a turn that already succeeded. */
      if (mayRemember && clerkToken && clerkUserId && factsConfigured() && looksDurable(lastUserText)) {
        void extractFacts({ text: lastUserText, availability, origin, signal: request.signal })
          .then(async (found) => {
            for (const fact of found) await rememberFact(clerkToken, clerkUserId, fact, undefined);
          })
          .catch(() => {});
      }

      const compactionCache = new Map<number, ModelMessage[]>();
      const messagesFor = async (attempt: typeof route): Promise<ModelMessage[]> => {
        const budget = Math.floor(PROVIDERS[attempt.provider].contextWindow * CONTEXT_INPUT_SHARE);
        const cached = compactionCache.get(budget);
        if (cached) return cached;
        const { messages: fitted, compacted } = await compactForBudget({
          messages: modelMessages,
          maxInputTokens: budget,
          availability,
          origin,
          abortSignal: request.signal
        });
        if (compacted) {
          writer.write(statusChunk({ stage: "gather", detail: "Condensing earlier turns to keep the thread in context." }));
        }
        compactionCache.set(budget, fitted);
        return fitted;
      };

      /* Health-ordered: a provider that has been failing across recent
         requests goes to the back of the line instead of charging every turn
         its timeout. Deprioritized, never dropped. */
      const attempts = orderRoutesByHealth([
        route,
        ...fallbackRoutes({ primary: route, availability, complex: complexRoute })
      ]);
      let lastFailure: unknown = null;

      for (const [index, attempt] of attempts.entries()) {
        if (index > 0) {
          writer.write(statusChunk({ stage: "gather", detail: "Switching to another engine." }));
        }
        /* Recomputed per lane, not once for the primary. Tool support is a
           property of the model, and a fallback lane can easily be a model
           that rejects a tools array outright — inheriting the primary's
           answer turns a recoverable failure into a guaranteed one. */
        const attemptToolNames = routeToolCallingSupport(attempt) === "custom" ? toolNames : [];
        const metered = attempt.provider === "deepseek";
        const attemptMessages = await messagesFor(attempt);
        const result = streamText({
        model: createProviderModel(attempt, origin),
        system: systemPrompt({ effort: effortLevel, productMode: mode, mode: dispatch === "code" ? "code" : "chat", tools, artifactRequested, request: lastUserText, retrieved: retrieval?.block, documents: documents.length ? documentsBlock(documents) : undefined, threadSummary, mcpContext, toolNames: attemptToolNames, userContext, memoryContext, playbookContext, constraints: constraintBlock(plan), capabilityRequested }),
        messages: attemptMessages,
        ...(attemptToolNames.length
          ? { tools: availableTools, stopWhen: stepCountIs(dispatch === "code" ? MAX_CODE_TOOL_STEPS : MAX_TOOL_STEPS) }
          : {}),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: { totalMs: 50_000, chunkMs: 14_000 },
        abortSignal: request.signal,
        experimental_transform: smoothStream({ delayInMs: 26, chunking: "word" }),
        onError: ({ error }) => console.error("NaviSoul provider stream failed:", error)
      });
      /* Billed from what the response actually reported, not from an estimate.
         Cache hits and misses differ in price by roughly fifty times, so a
         guess based on request counts would be wrong by orders of magnitude. */
      if (metered) void meterSpend(result, attempt.model);
      /* A provider that fails *mid-stream* never reaches the outer onError,
         and this inner stream's own default is the bare "An error occurred."
         that hid a hard model rejection behind three useless words. Route it
         through the same translator every other failure uses. */
      /* The QA gate. Reviewing an answer means having the whole answer first,
         which costs the streaming feel — so it is scoped to output that can be
         objectively wrong. Code either runs or it does not; prose "improved"
         by a second model just comes back blander, and the round trip is not
         free. Status lines keep the pause explained rather than looking hung. */
        /* The critique pass runs only when it has something real to check the
           draft against. Asked to "review your answer" with nothing to compare
           to, a model re-reads its own reasoning, finds it agreeable — it wrote
           it — and returns a reworded version at the cost of a full round trip.
           That is worse than no pass, because it spends the budget and adds a
           step where an error can be introduced. Retrieval and code execution
           are what finally make real grounding available. */
        const grounding = groundingFor({ retrieved: retrieval?.block });
        const shouldCritique = plan.needsReview && critiqueAllowed({ lane, grounding });
        if (plan.needsReview && !shouldCritique) {
          console.info("NaviSoul skipped the critique pass:", skipReason({ lane, grounding }));
        }
        if (shouldCritique) {
          writer.write(statusChunk({ stage: "draft", detail: "Drafting the implementation." }));
          let draft: string;
          try {
            draft = await result.text;
            markProviderSuccess(attempt.provider);
          } catch (error) {
            /* Nothing was shown, so another provider may still answer. */
            markProviderFailure(attempt.provider);
            lastFailure = error;
            continue;
          }
          if (!draft.trim()) { lastFailure = new Error("The response came back empty."); continue; }
          const spent = Date.now() - requestStartedAt;
          const reviewBudget = REQUEST_BUDGET_MS - spent - REVIEW_DELIVERY_RESERVE_MS;
          writer.write(statusChunk({ stage: "verify", detail: "Checking it against the constraints." }));
          const review = await reviewDraft({
            draft,
            request: lastUserText,
            plan,
            origin,
            budgetMs: reviewBudget,
            abortSignal: request.signal
          });
          const finalText = review.verdict === "revised" ? review.text : draft;
          const reviewedId = generateId();
          writer.write(statusChunk({ stage: "stream", detail: "Delivering the answer." }));
          writer.write({ type: "text-start", id: reviewedId });
          for (const chunk of splitLargePayload(finalText, 2_000)) {
            writer.write({ type: "text-delta", id: reviewedId, delta: chunk });
          }
          writer.write({ type: "text-end", id: reviewedId });
          writer.write(statusChunk({ stage: "complete", detail: "Response complete." }));
          return;
        }

        /* Read until this lane has actually produced something a person would
           see, buffering the protocol preamble on the way. Waiting for the
           *first* chunk was not enough: `start` arrives before the provider
           has committed to anything, so a lane that then 500s had already been
           chosen, and the failure reached the screen as a red card while two
           healthy lanes sat unused. This is what made the fallback look like it
           only covered 429 — every other failure simply arrived too late.

           A failure is silent while nothing has been shown, and reported once
           something has: restarting mid-answer would replay a partial reply. */
        try {
          /* Not sent at all going forward: private deliberation the user was
           never meant to see, which the client then stores and replays. */
        /* Sent to the screen, and stripped from the replay by
           `redactGeneratedMedia` before any model sees it again. Those are two
           different problems that were being solved with one switch: the trace
           is unsafe to *replay* — a provider that rejects `reasoning_content`
           breaks the conversation permanently — but it was never unsafe to
           show, and hiding it is most of why "thinking harder" felt like it
           changed nothing. */
        const stream = result.toUIMessageStream({ onError: streamError, sendReasoning: true });
          const reader = stream.getReader();
          const { committed, preamble, failure } = await readUntilCommitted(reader);

          if (!committed) {
            markProviderFailure(attempt.provider);
            lastFailure = failure ?? new Error("The provider produced no content.");
            continue;
          }

          markProviderSuccess(attempt.provider);
          reader.releaseLock();
          for (const chunk of preamble) writer.write(chunk as never);
          writer.merge(stream);
          return;
        } catch (error) {
          markProviderFailure(attempt.provider);
          lastFailure = error;
          continue;
        }
      }

      throw lastFailure ?? new Error("No provider could answer this request.");
    }
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Accel-Buffering": "no"
    }
  });
}
