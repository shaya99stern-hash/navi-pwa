/* First, and it has to stay first. This installs a `DOMException` constructor
   the edge runtime does not provide, and the AI SDK below builds its abort
   errors with one — on every retry backoff and every `smoothStream` delay. An
   import ordered after the SDK's would still run before any request, but this
   is a load-bearing side effect and reading it at the top is how it survives
   the next person tidying the import list. */
import "@/lib/ai/dom-exception";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  smoothStream,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage
} from "ai";
import { compactForBudget } from "@/lib/ai/compaction";
import { PROVIDERS, requestTokenCeiling } from "@/lib/ai/provider-registry";
import { describeRequestSize, estimateTextTokens, estimateToolTokens, measureRequest } from "@/lib/ai/request-size";
import { preflightPayload, type PromptBlock } from "@/lib/ai/navi-soul/payload-preflight";
import { runMission, shouldRunAsMission, type MissionReport } from "@/lib/ai/navi-soul/mission-loop";
import { ingestContent, learnFromMission, wantsLearning, type Lesson } from "@/lib/ai/navi-soul/learning-loop";
import { readUrl } from "@/lib/ai/web-tools";
import { LESSON_PREFIX } from "@/lib/memory/lesson";
import { decideLocally } from "@/lib/ai/navi-soul/router";
import { describePlan, planTurn } from "@/lib/ai/navi-soul/orchestrator";
import { createArtifactGate } from "@/lib/ai/artifact-gate";
import { IMAGE_ENGINES, generateNaviImage, type ImageAttachment } from "@/lib/ai/image-generation";
import { audioGenerationIntent, classifyAudioRequest, generateNaviAudio } from "@/lib/ai/audio-generation";
import { classifyTask, createProviderModel, engineName, fallbackRoutes, frontierConfigured, getProviderAvailability, lastResortRoute, routeForLane, routeToolCallingSupport, selectDirectRoute, selectLane, type ProviderAvailability } from "@/lib/ai/providers";
import { markProviderFailure, markProviderSuccess, orderRoutesByHealth } from "@/lib/ai/provider-health";
import { cachedRoute, refreshFreeModels } from "@/lib/ai/model-discovery";
import { getSpendStore, meteredLaneEnabled, readSpend, recordSpend, readUsage } from "@/lib/ai/spend";
import { buildMcpTools } from "@/lib/ai/mcp-tools";
import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import { isClerkUserAllowed } from "@/lib/auth/config";
import { readUntilCommitted } from "@/lib/ai/lane-commit";
import { githubOAuthConfigured, githubWritesEnabled, readGithubToken } from "@/lib/github/oauth";
import { googleAccessToken, googleOAuthConfigured } from "@/lib/google/oauth";
import { factsBlock, factsConfigured, listFacts, rememberFact } from "@/lib/memory/facts";
import { learnedSkillsBlock, learnedSkillsConfigured, listLearnedSkills } from "@/lib/memory/learned-skills";
import { REFLECTION_INSTRUCTION } from "@/lib/ai/reflection-tools";
import { extractFacts, looksDurable } from "@/lib/memory/extract";
import { hasWebSearch } from "@/lib/ai/web-tools";
import { executionInstruction, MAX_REPAIR_ROUNDS } from "@/lib/ai/execution-tools";
import { historyInstruction } from "@/lib/ai/history-tools";
import { withoutReasoning } from "@/lib/ai/replay";
import { parseCapabilities } from "@/lib/ai/capabilities/parse";
import { activeGroups, buildToolset, type ToolsetContext } from "@/lib/tools/registry";
import { detectRepo, retrieveFiles } from "@/lib/ai/repo-retrieval";
import { critiqueAllowed, groundingFor, skipReason, type FetchedSource } from "@/lib/ai/grounding";
import { runComposite } from "@/lib/ai/swarm";
import {
  architectPlan,
  constraintBlock,
  heuristicPlan,
  reviewUntilSound,
  shouldConsultArchitect,
  type ExecutionPlan
} from "@/lib/ai/architect";
import type { ConnectorAccessMode, CustomConnector, EffortLevel, ModelPreset, NaviEngineNote, NaviMode, NaviStreamStatus, ResponseStyle, SwarmPreset, ToolPolicy } from "@/lib/ai/types";
import { authorizeApiMutation } from "@/lib/auth/api";
import { gatherMcpMetadata, publicMcpRegistry } from "@/lib/mcp";
import { APP_KNOWLEDGE, selfRepoKnowledge } from "@/lib/ai/app-knowledge";
import { buildCapabilitySnapshot, capabilityBrief, type CapabilitySnapshot } from "@/lib/ai/navi-soul/capability-map";
import { derivedAppFacts } from "@/lib/ai/self-description";
import { NAVI_MISSION, needsMission } from "@/lib/ai/mission";
import { ORCHESTRATION_KNOWLEDGE, needsOrchestrationKnowledge } from "@/lib/ai/orchestration-knowledge";
import { ENGINEERING_DISCIPLINE, needsEngineeringDiscipline } from "@/lib/ai/engineering-discipline";
import { CODE_CRAFT, needsCodeCraft } from "@/lib/ai/code-craft";
import { fitReferenceBlocks, needsAppKnowledge, stablePrefix } from "@/lib/ai/prompt/base";
import { EFFORT_LEVELS } from "@/lib/chat";
import { csvToMarkdown, documentBlock, extractPdfText } from "@/lib/ai/document-text";

export const runtime = "edge";
/**
 * How long one answer may take end to end.
 *
 * This was 60 seconds, which became the real ceiling the moment the output cap
 * went from 1,900 tokens to 8,000: a long answer, or one that calls a few
 * tools, streams for longer than a minute, and the platform then kills the
 * function mid-sentence. The user sees the reply stop dead — the same symptom
 * as the token cap, from a different cause, and the one that would have
 * replaced it.
 *
 * 300 is not a guess: `app/api/eval/route.ts` already deploys at 300 on this
 * project, so the plan permits it.
 */
export const maxDuration = 300;
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
/* Tool steps are how much work one answer may do before it has to stop and
   reply. Eight was tuned against a 60-second function; with five times the
   wall clock, stopping at eight is the model abandoning a task it could have
   finished, which reads as it giving up half way. */
const MAX_TOOL_STEPS = 16;
/**
 * Code mode earns more hops: finding a bug is list repos → list directory →
 * read file → check CI → read log → answer, and cutting that off at four
 * leaves the model guessing at exactly the point it was about to know.
 *
 * This comment described the intent for a long time while the value stayed at
 * eight — identical to Chat — so the two modes differed in wording and in
 * nothing a person could feel. Editing the app is longer still: list, read,
 * read a caller, commit, report is five before any diagnosis has happened.
 * Fourteen covers a real repair loop. Wall-clock is bounded separately by the
 * request budget, so a longer ceiling cannot run away with the request.
 */
const MAX_CODE_TOOL_STEPS = 28;
/**
 * The wall-clock the whole request has, kept under `maxDuration` so a review
 * that starts late is skipped rather than started and killed.
 *
 * This read 52 seconds for a long time, against a comment describing a 60s edge
 * ceiling. That ceiling moved to 300 when `maxDuration` did, and this constant
 * did not follow — so the app spent months discarding its own best work against
 * a limit that no longer existed. Everything gated on the remaining budget is
 * expensive and optional by construction: the review rounds, the mission steps,
 * the later tool hops. Those are exactly the things a too-tight budget drops
 * first, which made the most sophisticated paths in the app the least likely to
 * run.
 *
 * 240s leaves a full minute under `maxDuration` for the answer to finish
 * streaming and the stream to close. The reserve below is separate and smaller:
 * it only protects delivery of an answer already in hand.
 */
const REQUEST_BUDGET_MS = 240_000;
const REVIEW_DELIVERY_RESERVE_MS = 2_000;
/** Past this many turns a conversation is a context problem, not a hard one. */
const LONG_CONTEXT_TURNS = 14;
/**
 * How many fetched pages one turn keeps as grounding material.
 *
 * A crawl can read a dozen pages, and the critique needs enough of them to
 * check a claim without the material itself becoming the budget. `groundingFor`
 * clips the total anyway; this bounds the array before it gets there.
 */
const MAX_TRACKED_SOURCES = 8;
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
/**
 * The shortest reply worth starting a request for.
 *
 * Used as the floor when the output cap is sized to what a route has left. If a
 * route cannot spare even this much after the prompt and the tool schemas, it
 * cannot serve the request at all and is skipped rather than sent a payload it
 * will refuse — see the attempt loop.
 */
const MIN_OUTPUT_TOKENS = 1_000;
/**
 * Held back from every ceiling.
 *
 * The token estimate is four-characters-to-one and the provider's tokeniser is
 * not, so a request sized exactly to the limit is a request that sometimes
 * lands just over it. The margin is what turns "usually fits" into "fits".
 */
const CEILING_SAFETY_MARGIN = 400;
/**
 * What the rest of a turn needs, so the reference blocks get what is left.
 *
 * Roughly: the base prompt prefix (~1,000 tokens, measured), the short
 * per-request instruction lines (~500), room for an actual conversation
 * (~1,000), and `MIN_OUTPUT_TOKENS` for the reply. Held back rather than
 * discovered, because the reference blocks have to be chosen *before* the
 * prompt containing them can be weighed.
 */
const PROMPT_RESERVE_TOKENS = 3_500;
/**
 * What a project's documents may contribute to one turn, in characters.
 *
 * About 4,000 tokens. Generous enough that a project of reference material is
 * genuinely useful, bounded because a project is replayed into *every*
 * conversation that belongs to it — an unbounded knowledge base is a permanent
 * tax on every request rather than a one-off cost, and it would arrive at the
 * routing budget from a direction nothing was measuring.
 *
 * The turn is still sized against the route afterwards, so this being too
 * generous for a free tier degrades to a route with more room rather than to a
 * failed request.
 */
const MAX_PROJECT_DOCUMENT_CHARS = 16_000;
/**
 * The effort dial, in the words the effort sheet already uses.
 *
 * Derived from `EFFORT_LEVELS` rather than restated, so the badge under a reply
 * and the control that set it can never drift into calling the same thing two
 * different names.
 */
const EFFORT_LABELS: Record<EffortLevel, string> = Object.fromEntries(
  EFFORT_LEVELS.map((level) => [level.id, level.label])
) as Record<EffortLevel, string>;

type ChatRequestBody = {
  messages?: UIMessage[];
  mode?: unknown;
  /** Diagnostics-only route pin. Absent for every ordinary request. */
  routeOverride?: unknown;
  /**
   * Which voice actually spoke the previous reply, reported by the device.
   *
   * The one fact about speech that only the phone holds: whether the audio
   * played. Validated on arrival like every other field here.
   */
  spokenBy?: { engine?: unknown; why?: unknown };
  /** The answer to this turn is going to be spoken aloud rather than read. */
  voice?: unknown;
  /** Measurements taken from the last artifact after it rendered on screen. */
  artifactAudit?: unknown;
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
  capabilities?: unknown;
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
  documents?: unknown;
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
/**
 * How long a single answer may be.
 *
 * This was 1,900 tokens — roughly 1,400 words — and it is written all over the
 * chat history as "Why do you keep stopping", "Continue where you left off",
 * "Continue from where you stopped", over and over in the same conversation.
 * The model was not stopping. It was being cut off mid-sentence, and then
 * asked to reconstruct its own place in an answer it could not see the end of,
 * which is why the resumptions repeated themselves and drifted.
 *
 * A cap this low is invisible as a bug and reads as the assistant being flaky
 * — the single most damaging kind of defect, because it makes every long
 * answer untrustworthy. Anything asked of an assistant that writes plans,
 * audits, or code exceeds 1,400 words routinely.
 *
 * 8,000 is a real ceiling rather than a guardrail: long enough that ordinary
 * work finishes in one turn, and still bounded so a runaway generation cannot
 * bill indefinitely.
 */
const MAX_OUTPUT_TOKENS = 8_000;
const ALLOWED_PRESETS = new Set<ModelPreset>([
  "navi-soul",
  "navi-code",
  "auto",
  "navi-soul-deep",
  "navi-soul-direct",
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
  /* The pre-v4.2.0 spellings stay here and only here: this maps what an old
     client sends onto a mode, so the keys have to match what those clients
     actually put on the wire. */
  "navi-code": "code", "navi-fable": "code", "navi-5": "code", "fable-5": "code",
  "navi-soul-deep": "code",
  "navi-soul": "chat", "navi-sol": "chat", "navi-soul-direct": "chat", "navi-chat": "chat", auto: "chat",
  "gemini-direct": "chat", "groq-direct": "chat", "huggingface-direct": "chat"
};

function normalizePreset(value: unknown): ModelPreset {
  /* The aliases borrowed from other companies' model names are gone. They only
     ever served clients from before v4.2.0, and `LEGACY_PRESET_MODE` above
     already maps those same request bodies to a mode — while any preset this
     function does not recognise falls through to `navi-soul`, which is where
     such a client was heading anyway. What is left are this product's own
     retired names. */
  const legacy: Record<string, ModelPreset> = {
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
  /* Documents the project carries, as text. Named individually so the model
     can say which one a fact came from — an unattributed wall of prose is how
     a project's own files end up cited as though they were the web.

     Budgeted per document *and* in total. A project is replayed into every
     conversation that belongs to it, so an unbounded knowledge base is a
     permanent tax on every turn — the same shape as the 20,000-token prompt,
     arriving from a direction nothing was watching. Whatever survives is then
     bounded again by the slice at the end. */
  const documents = Array.isArray(project.documents)
    ? project.documents
      .filter((item): item is { name?: unknown; text?: unknown } => Boolean(item) && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim().slice(0, 120) : "Document",
        text: typeof item.text === "string" ? item.text.trim() : ""
      }))
      .filter((item) => item.text)
      .slice(0, 20)
    : [];

  let documentBudget = MAX_PROJECT_DOCUMENT_CHARS;
  const documentBlocks: string[] = [];
  for (const document of documents) {
    if (documentBudget <= 0) break;
    const text = document.text.slice(0, documentBudget);
    documentBudget -= text.length;
    documentBlocks.push(`### ${document.name}\n${text}`);
  }

  return [
    `Active project: ${name}`,
    instructions ? `Project instructions:\n${instructions}` : "",
    knowledge.length ? `Project knowledge:\n${knowledge.map((item) => `- ${item}`).join("\n")}` : "",
    documentBlocks.length
      ? `Project documents, read as text. Reason from them directly, and name the document when a fact comes from one:\n\n${documentBlocks.join("\n\n")}`
      : "",
    "Treat project instructions, knowledge, and documents as durable user-provided context. Do not claim they came from external sources."
  ].filter(Boolean).join("\n\n").slice(0, 6_000 + MAX_PROJECT_DOCUMENT_CHARS);
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
  code: "Navi Soul · code",
  research: "Navi Soul · research",
  reasoning: "Navi Soul · reasoning",
  general: "Navi Soul"
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

/**
 * That the person on the other end owns this deployment.
 *
 * Nothing ever said so. The user's report — "Navi Soul doesn't see me as the
 * owner and it needs to listen to anything I tell it" — is the visible half of
 * a real gap: the model was told about tools, modes, and a profile that is
 * empty by default, and never that the single authenticated user of a
 * single-user deployment is the person whose app this is. So it hedged,
 * deferred, and told the owner what it was "not allowed" to do in their own
 * product.
 *
 * This is a statement of standing, not a grant of new powers. It does not
 * loosen a single guard: `write-guards.ts` still governs what may be written,
 * confirmation is still required for destructive or outward-facing actions,
 * and the honesty rules still outrank any instruction to overstate what
 * happened. Being the owner means their preferences settle product questions —
 * how the app should look, behave, and be built — not that refusals and
 * safety checks stop applying to them.
 *
 * ## Standing to know, which is not the same as standing to decide
 *
 * The first version settled authority and left the other half open. Asked what
 * was configured, what a key does, or why something is off, the reply came back
 * hedged — the shape a model reaches for when a question sounds like it might
 * be about someone else's secrets. Nobody else uses this deployment. Its
 * configuration is the owner's own, they are the person who set it, and a
 * hedge there is not caution, it is an assistant refusing to read its own
 * settings screen aloud to the person who wrote it.
 *
 * The one thing that stays shut is the credential *value*. That is not a
 * concession to modesty: a secret pasted into a conversation is a secret in
 * every backup, sync, and export of that conversation afterwards, and the
 * owner gains nothing from seeing a string they can read in Vercel. Which
 * variables are set, what each governs, what is failing, and what to do about
 * it — all of that is theirs, in full, and it comes from looking rather than
 * from remembering.
 */
function ownerBlock(isOwner: boolean): string {
  if (!isOwner) return "";
  return [
    "The person you are talking to owns and operates this NaviOS deployment. It is their product.",
    "Their decisions about how NaviOS should look, behave, and be built are final — do not argue design or product direction with them once they have decided, and do not tell them a product choice is not yours to make.",
    "When they ask you to change the app, treat it as authorised work: read the real files, make the change, and report exactly what you did.",
    "This settles authority, not accuracy. Never tell them something worked when it did not, never claim to have saved, committed, or learned something unless a tool result says so, and keep asking before destructive or irreversible actions.",
    /* The half that was missing. Every question about configuration is a
       question about their own property, and the honest answer to all of them
       begins with looking rather than recalling. */
    "Nobody else uses this deployment. Its configuration is theirs, and every question about it — what is set, what is failing, which variable governs what, why a capability is off — is a question about their own property. Answer those in full, from `inspect_environment` and the other diagnostic tools rather than from memory, and never hedge as though the setup belonged to someone else.",
    "The single exception is a credential's value. Do not print one, because a secret repeated into a conversation is in every copy of that conversation afterwards, and they can already read it where they set it. Name the variable, say whether it is set, say what it enables — that is the useful part, and none of it is withheld."
  ].join("\n");
}

function artifactInstruction(requested: boolean): string {
  const contract = [
    "NaviOS artifacts are real interactive documents rendered in an isolated browser sandbox.",
    "Emit them as a fenced navi-artifact JSON block containing id, title, kind, html or svg, and height.",
    /* The budget, stated up front. It is enforced at 180 KB and the model was
       never told, so it would generate a large document, have it silently
       rejected, and then — with no error to read — invent an explanation and
       try again at the same size. The chat history has exactly that loop, three
       attempts deep, over a chat-history export. A limit nobody is told about
       is a trap rather than a limit. */
    "An artifact must stay under 180 KB of content. Plan for that before you start: if the material will not fit, say so first and either narrow it or split it into several artifacts the user asks for one at a time. Do not emit one you expect to be over the limit.",
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
    "You are Navi Soul working in NaviOS Chat.",
    "Answer in prose. Explain in plain language first, and reach for a code block only when the user asked for code or when nothing else can express the answer.",
    "Prefer the shortest complete answer. Where a question has a short answer and a long one, give the short one and offer to go further.",
    "Engage with what was actually asked rather than the general topic around it, and pick up the thread of the conversation instead of restarting it each turn.",
    "When a request would be better served in Code mode — a repository, a stack trace, a build — say so in one line and answer anyway."
  ].join(" ");
}

/** The behavioural difference between the Chat and Code models lives here. */
function codeModeInstruction(canCommit: boolean, canWriteRepos: boolean): string {
  return [
    "You are Navi Soul working in Code mode.",
    "Prefer working code over prose about code: give complete, runnable snippets with the imports they need, and state the language and file path when it matters.",
    "When debugging, reason from the actual error text and the code shown; name the root cause before proposing the fix, and keep the fix minimal.",
    "Match the conventions of any code the user shows you. Flag breaking changes, missing tests, and security problems even when unasked.",
    "If a request is ambiguous between several implementations, pick the most conventional one and say what you assumed.",
    "When repository or deployment tools are available, read the real file, the real CI log, or the real build log before diagnosing. Never describe code you have not read or guess at an error you could have fetched.",
    /* This line used to be unconditional, and it was a standing instruction to
       refuse. Every Code-mode turn ended with "those tools are read-only... say
       it has to be applied by hand" — including the turns where
       `commit_own_source` was sitting right there in the toolset. The owner
       asked repeatedly why Navi Soul would not just make the change; this is
       why. It was doing what it was told.

       A capability statement has to be derived from the tools actually present,
       or it is a guess about the app made by the app about itself. */
    canCommit
      ? "You can commit to NaviOS's own repository with commit_own_source, and every commit deploys automatically. When the user asks you to change this app, do it: read the real file first, write the complete new contents, commit, and then say plainly what you changed and link the commit. Do not hand them a diff to apply themselves, and do not ask permission for a change they have already asked for. If a commit is rejected, say so and why — never imply it landed."
      : "",
    /* Two different repositories, two different mechanisms, and the model kept
       conflating them — telling the owner it could write to "NaviOS's own
       source" but not to their other repositories, as though that were a rule
       about repositories rather than about which token was present.
       It is not one capability with an exception. It is two:
         · this app's own source, through the deployment's token, committed
           straight to the working branch, and deployed on merge;
         · any repository the *user* has connected with their own GitHub
           account, through branch-and-pull-request, touching nothing directly.
       Saying which one applies is the difference between "I cannot" and "I can,
       on a branch, and here is the PR". */
    canWriteRepos
      ? "You can also work in the user's other GitHub repositories — any repository their connected account can reach, not only this app. Use github_create_branch, then write files, then github_open_pr: never commit to a default branch in someone's repository. Read a file before you change it. When they ask you to change a repository, do the work and give them the pull request; do not describe the change and stop."
      : "",
    !canCommit && !canWriteRepos
      ? "Repository tools are read-only in this request: you can inspect repositories and deployments but cannot commit, merge, or deploy. If a task needs a write, give the exact change and say it has to be applied by hand. Do not describe this as a permanent limitation — it depends on a connected GitHub account and a deployment setting, and diagnose_self reports which is missing."
      : ""
  ].filter(Boolean).join(" ");
}

/**
 * The prompt as one string, for every caller that just wants to read it.
 *
 * The blocks below are the real assembly; this is the join. Both exist because
 * the preflight needs to be able to drop a block without rebuilding the prompt
 * from its inputs, and everything else needs a string.
 */
/**
 * What this deployment can actually do, assembled from the objects that know.
 *
 * `buildCapabilitySnapshot` was written to be the single answer to that
 * question for three surfaces — the prompt, the `/capabilities` command, and
 * Settings — and had no callers at all. So the prompt's account of its own
 * capabilities was whatever prose happened to be loaded, which is how an app
 * with no GitHub credential still described committing to a repository.
 *
 * Every input is passed rather than reached for, so this cannot drift from what
 * it describes: availability from the provider layer, tool groups from the same
 * context object that built the toolset, image engines gated on the credential
 * each one actually needs.
 */
function capabilitySnapshotFor(options: {
  availability: ProviderAvailability;
  toolsetContext: ToolsetContext;
}): CapabilitySnapshot {
  /* Gated on the provider each engine runs on. Listing an engine whose
     credential is absent would be the same unchecked claim this block exists to
     replace — the model would offer a picture it cannot draw. */
  const engines: Array<{ name: string; detail: string }> = [];
  if (options.availability.gemini) engines.push({ name: IMAGE_ENGINES.navi.name, detail: IMAGE_ENGINES.navi.detail });
  if (options.availability.huggingface) {
    engines.push({ name: IMAGE_ENGINES.studio.name, detail: IMAGE_ENGINES.studio.detail });
    engines.push({ name: IMAGE_ENGINES.text.name, detail: IMAGE_ENGINES.text.detail });
  }

  return buildCapabilitySnapshot({
    availability: options.availability,
    toolGroups: activeGroups(options.toolsetContext),
    /* Genuinely unknown here. The instant skills live in a `"use client"`
       module the edge runtime cannot import, so a server-built snapshot has no
       count — and `capabilityBrief` omits the line rather than printing zero,
       because "0 on-device skills" is a false claim where silence is not. */
    skillCount: 0,
    mcpServers: publicMcpRegistry().map((server) => ({ id: server.id, name: server.name })),
    imageEngines: engines,
    frontier: frontierConfigured()
  });
}

function systemPrompt(options: Parameters<typeof systemPromptBlocks>[0]): string {
  return systemPromptBlocks(options).map((block) => block.text).join("\n\n");
}

function systemPromptBlocks(options: {
  effort: EffortLevel;
  /** The dispatch lane, which decides how the answer is shaped. */
  mode: "chat" | "code";
  /** The product mode the user chose. Chat mode still answers code questions. */
  productMode: NaviMode;
  tools: ToolPolicy;
  artifactRequested: boolean;
  /** The request itself, read only to decide which optional blocks load. */
  request?: string;
  /**
   * The optional blocks Navi Soul's plan says this turn earned.
   *
   * `planTurn` has been computing this list since it was written and nothing
   * has ever read it, so two of the three names in it described blocks that
   * were never assembled. It is the authority here now, rather than a second
   * opinion: a planner whose decisions are re-derived at the call site is not
   * a planner, it is a log line.
   */
  promptBlocks?: string[];
  /**
   * What this deployment can actually do, checked while the request was built.
   *
   * Absent when the plan did not ask for it, because every line is charged to
   * the turn.
   */
  capabilities?: CapabilitySnapshot;
  threadSummary?: string;
  mcpContext?: string;
  toolNames?: string[];
  userContext?: string;
  /** The caller owns this deployment; see `ownerBlock`. */
  isOwner?: boolean;
  memoryContext?: string;
  playbookContext?: string;
  /** The request asked Navi to learn something, so it may offer a capability. */
  capabilityRequested?: boolean;
  /** This answer is going to be spoken aloud rather than read. */
  spoken?: boolean;
  /**
   * Which voice actually spoke last, and why it was not the premium one.
   *
   * The device knows and the server cannot: whether the audio played is a fact
   * about a phone, not about a configuration. Without it, "isn't it supposed to
   * be using the Eleven Labs voice?" had no truthful answer available, and the
   * model filled the gap with an invented architecture.
   */
  spokenBy?: { engine: string; why: string };
  /** What the last artifact measured once rendered. Empty when it was fine. */
  artifactAudit?: string;
  /** Repository files fetched before generating, when the repo was knowable. */
  retrieved?: string;
  /** Attached documents, extracted as text rather than shown as pages. */
  documents?: string;
  /** The plan Soul made for this request, and what the answer must satisfy. */
  constraints?: string;
  /**
   * Tokens the large reference blocks may spend between them.
   *
   * Derived from the chosen route's own ceiling by the caller, because how much
   * background this turn can afford is a property of where it is being sent.
   * Omitted means unlimited, which is what every non-streaming caller wants.
   */
  referenceBudget?: number;
}): PromptBlock[] {
  const { effort, mode, tools, artifactRequested, request = "", promptBlocks = [], capabilities: capabilitySnapshot, threadSummary, mcpContext, toolNames = [], userContext, isOwner = false, memoryContext, playbookContext, constraints, retrieved, documents, capabilityRequested = false, spoken = false, spokenBy, artifactAudit, productMode, referenceBudget = Number.POSITIVE_INFINITY } = options;

  /* The static reference material, in priority order, competing for whatever
     room the route has. Each predicate is unchanged — this decides which of
     the blocks they admit can actually be afforded, not whether they apply.

     Ordered by what is worst to be wrong about. Which repository this app is
     goes first because it is a few dozen tokens and a confident wrong answer
     to "which repo is this" is the failure that motivated the block. The app
     description follows, because inventing an answer about the product the
     user is holding is the next worst. Routing knowledge is last: describing
     its own lanes slightly less well is the cheapest thing to lose. */
  const referenceCandidates = [
    /* The block ships on either condition; what it is allowed to claim depends
       on the first one alone. Asking about the app is a reason to be told which
       repository it is, never a reason to be told it can be committed to. */
    { name: "self-repo", text: toolNames.includes("commit_own_source") || needsAppKnowledge(request)
      ? selfRepoKnowledge({ canCommit: toolNames.includes("commit_own_source") })
      : "" },
    { name: "app-knowledge", text: needsAppKnowledge(request) ? APP_KNOWLEDGE : "" },
    /* The half of the self-description the code can state about itself:
       screens, which variable governs which capability, and what can be
       connected. Carried on the same condition as the prose above, because
       either one alone is half a description — and placed after it so the
       facts are what the model reads last. */
    { name: "app-facts", text: needsAppKnowledge(request) ? derivedAppFacts() : "" },
    { name: "engineering-discipline", text: needsEngineeringDiscipline(toolNames.includes("commit_own_source")) ? ENGINEERING_DISCIPLINE : "" },
    { name: "code-craft", text: needsCodeCraft(toolNames.includes("commit_own_source")) ? CODE_CRAFT : "" },
    { name: "mission", text: needsMission(request) ? NAVI_MISSION : "" },
    /* Both of these are now the plan's call rather than this list's.
       `planTurn` decides them from the same predicates in the same order —
       `tests/prompt-block-parity.test.ts` holds the orchestration one to that
       across every turn shape — and the point of moving them is that the
       capability brief was decided by nobody at all: `wantsCapabilityBrief`
       was reachable only through `planTurn`, whose output went to a
       `console.log`, so a turn asking "what can you actually do" earned a block
       that was never assembled.

       Last in the list, which is where the cheapest thing to lose belongs.
       The capability brief sits just above it: when a turn cannot afford both,
       a checked list of what is on right now is worth more than a description
       of how routing works. */
    { name: "capability-brief", text: promptBlocks.includes("capability-brief") && capabilitySnapshot ? capabilityBrief(capabilitySnapshot) : "" },
    { name: "orchestration", text: promptBlocks.includes("orchestration-knowledge") ? ORCHESTRATION_KNOWLEDGE : "" }
  ];
  const { dropped } = fitReferenceBlocks(referenceCandidates, referenceBudget);
  /* The same blocks `fitReferenceBlocks` kept, still carrying their names: it
     answers with text alone, and the preflight downstream needs to be able to
     say which block it dropped. Order and membership are its decision, not a
     second one made here. */
  const reference = referenceCandidates.filter((block) => block.text && !dropped.includes(block.name));
  if (dropped.length) console.info(`Navi Soul trimmed reference blocks to fit ${referenceBudget} tokens: dropped ${dropped.join(", ")}.`);
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
  /* One addressable list rather than one string.
     `preflightPayload` shrinks a turn that a route will not accept by dropping
     optional blocks from the end, so the reference material — the only part of
     this prompt a turn can lose and still be answered — is marked optional in
     the order it is already prioritised in above. Everything else is required:
     the prefix carries the constitution, and the per-request lines are what
     make this turn this turn.

     Joined, this is byte-for-byte the string it replaced. */
  return [
    /* Base plus mode body: one constant string per mode, assembled from parts
       rather than branched inside. Roughly 500 tokens where the old prompt
       spent 3,000, most of which was a description of the app that only
       mattered when someone asked about the app. */
    { name: "stable-prefix", text: stablePrefix(productMode === "code" ? "code" : "chat") },
    /* The reference material, already trimmed to what this route can afford.
       Which blocks apply is decided by the predicates above; which of them fit
       is decided by `fitReferenceBlocks`. Both questions used to be answered by
       the first, which is how eight thousand tokens of background arrived at a
       route with an eight thousand token allowance. */
    ...reference.map((block) => ({ name: block.name, text: block.text, optional: true })),
    /* Memory, lifted out of the turn block and made droppable.
       It used to sit inside `turn`, which is required, so `preflightPayload`
       could not touch it — and its trim order is optional blocks, then tools,
       then conversation history. A turn too large for its route therefore
       deleted what the user had just said in order to keep repeating what it
       learned about them months ago. That is backwards on any reading: the
       remembered facts are worth less than the sentence they are being
       remembered during.

       Placed after the reference material rather than before it, which is the
       conservative half of a real trade. Dropping from the end means memory now
       goes before generic background does, and a case can be made that facts
       about this person outrank a description of the app. Moving it up would
       also move a per-user string ahead of the two largest stable blocks, and
       the note above is explicit that the metered lane bills an uncached prefix
       at roughly fifty times a cached one. Fixing the ordering against a
       measured cache-hit rate is worth doing; guessing at it here is not. */
    { name: "memory", text: memoryContext || "", optional: true },
    { name: "turn", text: [
    /* Keyed to the mode the user actually chose, not to how the dispatcher
       classified this message. Keying it to dispatch meant that picking Code
       and then asking something the classifier read as ordinary produced a
       reply identical to Chat's — which is precisely the "switching modes
       doesn't feel different" complaint. The switch is an instruction from
       the user; it applies until they move it back. */
    productMode === "code" ? codeModeInstruction(toolNames.includes("commit_own_source"), toolNames.includes("github_open_pr")) : chatModeInstruction(),
    playbookContext || "",
    effortInstruction(effort),
    ownerBlock(isOwner),
    userContext || "",
    toolNames.length
      ? `You can call these tools and their results are real: ${toolNames.join(", ")}. Call one whenever it would answer better than recalling — anything current, factual, personal, or specific to the user's own data. Never do arithmetic, unit conversion, date maths, or counting in your head when a tool will do it exactly; approximating those is the most common way you are wrong. Prefer searching and reading a source over answering from memory, and cite the URLs you actually read.`
      : "You have no callable tools in this request. Answer from your own knowledge, and say plainly when something needs live data you cannot reach.",
    /* Read off the toolset itself rather than off the search key, because
       searching and reading are two different capabilities and conflating them
       produced a flat lie. Both branches here used to deny browsing whenever no
       search provider was configured — while `fetch_url` sat in the very list
       printed two lines above, needing no key, working, and able to chain a
       dozen hops. The app talked its own model out of the one web capability it
       always has. */
    toolNames.includes("web_search")
      ? ""
      : toolNames.includes("fetch_url")
        ? "You have no search engine on this request, but fetch_url reads any URL directly and its results are real. Use it on links the user gives you and on addresses you already know; follow links out of a page you fetched when the answer is a hop away. Only say you could not look something up when you also could not read a page that would have answered it."
        : "You cannot search or read web pages in this request. Say so plainly rather than implying you looked something up.",
    /* The capability is the app's own now, not the route's. It used to be
       described as available "only when the selected route actually supplies
       it", which made a core ability hostage to whichever provider answered. */
    tools.code && toolNames.includes("run_javascript") ? executionInstruction() : "",
    /* Read off the toolset, like the browsing lines above, so the prompt can
       never describe a capability the turn does not actually hold. */
    toolNames.includes("search_history") ? historyInstruction() : "",
    tools.artifacts ? artifactInstruction(artifactRequested) : "",
    capabilityRequested ? capabilityInstruction() : "",
    /* How to write for an ear rather than an eye.
       This changes the writing, never the work: the reasoning, the tools, and
       the depth are identical to a typed turn. What changes is that markdown a
       voice cannot pronounce becomes noise, a list read aloud is a drone, and a
       sentence built to be re-read is unfollowable the first time through. A
       premium voice reading a bulleted report still sounds like a machine —
       cadence lives in the sentences, not the timbre. */
    spoken
      ? [
        "This answer will be spoken aloud, so write it to be heard once, not read.",
        "Short sentences. One idea at a time. No headings, no bullets, no bold, no code fences, no emoji, no markdown of any kind — a voice cannot pronounce them and they arrive as noise.",
        "Open with the answer, not a preamble. Lead with the thing they asked for and let the detail follow.",
        "Say numbers, dates and units the way a person would speak them.",
        "Be unhurried and plain. Contractions are natural; a clause that needs re-reading is one that cannot be followed the first time.",
        "Keep it to a few sentences unless more was clearly asked for, and if the full detail matters, say the short version aloud and note that the rest is on screen.",
        "If a task will take a while, say so in a sentence and get on with it rather than narrating each step."
      ].join(" ")
      : "",
    /* What the previous utterance actually did, so a question about the voice
       is answered from what happened. The model was asked why it did not sound
       like the chosen voice and invented a reason — that premium speech was
       "only for reading aloud long passages, not the chat voice" — while the
       screen said, in the app's own words, that this device had refused to play
       the audio. One ladder speaks everything aloud; there is no second voice
       to switch to, and the honest answer was already on the page. */
    spokenBy && spokenBy.engine !== "premium"
      ? `The last reply was spoken in ${spokenBy.engine === "device" ? "this device's own voice" : "no voice at all"}${spokenBy.why ? `, because ${spokenBy.why}` : ""}. If the user asks why it does not sound like the voice they chose, that is the reason — say it plainly. Do not invent a distinction between a "chat voice" and a reading-aloud voice, and do not offer to switch between them: one ladder speaks every reply, premium first and this device's own voice when premium cannot run. Call \`inspect_environment\` before naming any variable, and never guess one.`
      : "",
    /* Memory moved out of this block and into its own optional one above.
       Inside here it was un-droppable, which made the conversation the first
       thing sacrificed to an oversized request. */
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
    /* What the last artifact measured once it was actually on screen.
       The reviewer runs before delivery and an artifact renders after it, so
       the turn that produced a 900px frame around 400px of content can never
       be told. This is that turn's report, arriving at the next one — which is
       where "make this more realistic" lands anyway.
       Numbers rather than adjectives, because "488px of dead space below the
       content" can be acted on and "looks empty" cannot. */
    artifactAudit || "",
    constraints || ""
    ].filter(Boolean).join("\n\n") }
  ].filter((block) => block.text);
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
 * to Navi Soul and Navi Soul has no vendors. It does not apologise, because an
 * apology is not information and reads as evasion when repeated. And it says
 * what to do next, because the only useful part of an error is the next step.
 *
 * Every original message goes to the server log, where the detail belongs.
 */
function streamError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Navi Soul stream error:", error);
  const lower = message.toLowerCase();
  if (lower.includes("image providers") || lower.includes("image-generation provider")) return "Image generation is unavailable right now. Tap to retry in a moment.";
  /* Checked before the rate-limit branch, because the provider's own words for
     this are "Request too large ... tokens per minute" and the substring
     `rate limit` would otherwise claim it. They need different answers: waiting
     fixes a rate limit and does nothing at all for a request that is too big. */
  if (lower.includes("more room than any configured route") || lower.includes("request too large") || lower.includes("too large")) {
    return "This request is too big for the engines available. Start a new chat, detach any files, or lower the effort.";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) return "Too many requests just now. Tap to retry in a moment.";
  if (lower.includes("api_key") || lower.includes("api key") || lower.includes("credential") || lower.includes("401") || lower.includes("403") || lower.includes("forbidden")) {
    return "Navi Soul has no working credential to answer with. Add one in Settings.";
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
    console.info("Navi Soul metered request", { model, ...parsed });
    await recordSpend(parsed, tier);
  } catch (error) {
    console.error("Navi Soul could not meter a request:", error);
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
      console.warn("Navi Soul could not read an attached document:", error);
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
  if (preset === "navi-soul" || preset === "auto") return "navi-soul-direct";
  // The long-horizon build swarm — the right escalation for code.
  if (preset === "navi-code") return "navi-soul-deep";
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
      : reason?.error || "Navi Soul could not authorize this request.");
  }
  if (isRateLimited(clientIdentifier(request))) return refuse("You are sending messages faster than Navi Soul can answer them. Wait a few seconds and try again.", { "Retry-After": "30" });

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return refuse("Navi Soul could not read that request. Reload the app and try again.");
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
  /* Owner of this deployment. With an allowlist configured that is exactly the
     named accounts; without one, a signed-in user of a single-owner deployment
     is the owner — which is what this app is. Signed out is never the owner. */
  const isOwner = Boolean(clerkUserId) && isClerkUserAllowed(clerkUserId!);

  if (!Array.isArray(body.messages) || body.messages.length === 0) return refuse("There was no message to send.");
  /* A long conversation is trimmed, not refused.
     This used to return an error telling the user to start a new chat, which
     is the most complete stop the app can produce: the thread they were in the
     middle of simply stopped accepting messages. The very next line already
     slices to the last MAX_MESSAGES, and `threadSummary` carries a condensed
     version of everything older — so the refusal was throwing away a
     conversation the code was equipped to continue. */
  if (JSON.stringify(body.messages).length > MAX_SERIALIZED_CHARACTERS) return refuse("This conversation and its attachments are too large to send. Start a new chat, or remove an attachment.");

  const messages = body.messages.slice(-MAX_MESSAGES);
  const fileError = validateFiles(messages);
  if (fileError) return refuse(fileError);

  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const lastUserText = textOf(lastUserMessage);
  if (!lastUserText) return refuse("Add a short description of what you want Navi Soul to do with this.");

  const currentImageAttachments = imageAttachments(lastUserMessage);
  const imageRequested = imageGenerationIntent(lastUserText, currentImageAttachments.length > 0);
  /* The client sends a mode. A route pin is diagnostics only, and a v4.2.0
     client that has not reloaded still sends `preset` — all three collapse
     here so nothing downstream has to know which arrived. */
  const mode: NaviMode = body.mode === "code" ? "code" : body.mode === "chat" ? "chat" : LEGACY_PRESET_MODE[String(body.preset ?? "")] ?? "chat";
  const preset = normalizePreset(body.routeOverride ?? (mode === "code" ? "navi-code" : "navi-soul"));
  const effortLevel = effortFromBody(body);
  /* Strictly boolean. A client that has not reloaded since this shipped sends
     nothing at all, which reads as a written answer — the behaviour it has
     always had. */
  const spokenReply = body.voice === true;
  /* Narrowed to the shapes this app produces. It reaches a prompt, so it is
     held to a known vocabulary rather than passed through as typed — the same
     rule every other device-supplied field here follows. */
  const spokenBy = ((): { engine: string; why: string } | undefined => {
    const raw = body.spokenBy;
    if (!raw || typeof raw !== "object") return undefined;
    const engine = (raw as { engine?: unknown }).engine;
    if (engine !== "premium" && engine !== "device" && engine !== "silent") return undefined;
    const why = (raw as { why?: unknown }).why;
    return { engine, why: typeof why === "string" ? why.slice(0, 200) : "" };
  })();

  /**
   * The last artifact's measurements, rendered for the prompt.
   *
   * Bounded on every axis because this arrives from the client: a count, a
   * length per finding, a length for the title. It describes the app's own
   * rendered output rather than carrying instructions, but it is still a
   * string a request body chose, and it is placed in the prompt — so it is
   * treated as input rather than trusted as telemetry.
   */
  const artifactAuditBlock = (() => {
    const raw = body.artifactAudit;
    if (!raw || typeof raw !== "object") return undefined;
    const entry = raw as { title?: unknown; findings?: unknown };
    const findings = Array.isArray(entry.findings)
      ? entry.findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8)
      : [];
    if (!findings.length) return undefined;
    const title = typeof entry.title === "string" ? entry.title.slice(0, 80) : "the last artifact";
    return [
      `Measurements taken from “${title}” after it rendered on the user's screen. These are facts about the delivered output, not guesses:`,
      ...findings.map((item) => `- ${item.slice(0, 200)}`),
      "If this turn revises that artifact, fix these as well as whatever was asked. Do not mention this list."
    ].join("\n");
  })();
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

  /* A tool nothing prompts is a tool nothing calls.
   *
   * `record_lesson` exists so Navi Soul stops re-deriving what it already
   * worked out, but a model does not go looking for a tool it has no reason to
   * think about. The instruction sits with the memory context because that is
   * where it is already reasoning about what it knows, and it is gated on the
   * same condition as the tool — describing a capability that was not built
   * this turn is exactly how it ended up claiming saves that never happened. */
  const reflectionContext = mayRemember && clerkToken && clerkUserId && learnedSkillsConfigured()
    ? REFLECTION_INSTRUCTION
    : "";

  const memoryContext = [memoryCapability, reflectionContext, rememberedBlock, skillsContext, recalledContext].filter(Boolean).join("\n\n");
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
      /* One registry decides what Navi Soul can do this turn, rather than five
         builders assembled here with five separate ideas of when they apply.
         It also enforces the ceiling on how many tools go out — past roughly a
         dozen, selection accuracy falls and every turn pays the schema cost of
         the ones the model will not call. */
      /* What the model genuinely read this turn, in the order it read it.
         Filled by the fetch tool itself, because that is the only place that
         knows a read succeeded — the tool's return value goes to the model and
         nowhere else, so until now a real citation and an invented one were
         indistinguishable from outside the conversation. */
      const fetchedSources: FetchedSource[] = [];

      /* Named, because two things need to agree about it: the toolset itself,
         and the capability brief's account of which groups are switched on.
         Deriving the second from anything other than the object that built
         the first is how a description drifts from what it describes. */
      const toolsetContext: ToolsetContext = {
        mode,
        policy: tools,
        onSource: (source) => {
          /* Capped, and first-read wins. A crawl that reads the same page twice
             should not weigh it twice, and a turn that reads forty pages should
             not hand the critique forty — `groundingFor` clips the material
             anyway, and the earliest reads are the ones the answer was actually
             built on. */
          if (fetchedSources.length >= MAX_TRACKED_SOURCES) return;
          if (fetchedSources.some((seen) => seen.url === source.url)) return;
          fetchedSources.push(source);
        },
        githubToken: userGithubToken,
        googleAccessToken: userGoogleToken ?? undefined,
        /* Whether each account *could* be connected, which is a different
           question from whether it is. Without these, "why is Google not
           working" has two possible answers — nobody signed in, or this
           deployment has no OAuth app — and no way to tell them apart. */
        githubOAuthAvailable: githubOAuthConfigured(),
        googleOAuthAvailable: googleOAuthConfigured(),
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
        /* Same gate as the connectors beside them: "ask" means this chat does
           not reach the owner's own services without being asked first, and an
           added API is one of those. */
        capabilities: connectorAccessMode === "ask" ? [] : parseCapabilities(body.capabilities),
        signal: request.signal,
        /* Python runs on a Node route because the sandbox SDK cannot run on
           Edge. The origin lets the tool reach it; the cookie makes sure that
           route sees the same signed-in user this one did. */
        origin,
        cookie: request.headers.get("cookie") ?? undefined,
        onActivity: announce,
        mcpTools
      };
      const availableTools = buildToolset(toolsetContext);
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

      const modelMessages = withoutReasoning(await convertToModelMessages(redactGeneratedMedia(messages)));

      if (resolvedPreset === "navi-soul-deep" || resolvedPreset === "navi-soul-direct") {
        const swarmProfile: SwarmPreset = resolvedPreset;
        writer.write(statusChunk({
          stage: "plan",
          detail: swarmProfile === "navi-soul-deep"
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

      /* Kept only as the safety net for a non-model plan below. The lane that
         actually serves the turn comes from `planTurn`, which reclassifies the
         mode before choosing one. */
      const laneFromInputs = selectLane({
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

      /* Obeyed, at last.
         `planTurn` composes exactly what this route used to assemble inline —
         lane, route, health-ordered fallbacks, the metered floor, the optional
         prompt blocks this turn earned — from the same functions in the same
         order. It has been computing all of that for a while and sending it to
         a `console.log`.

         The note that stood here said the switch would be flipped "once these
         lines agree in the logs". They could not have: `TurnContext` had no
         `preset`, and this route branches on exactly that, so no volume of
         production traffic would ever have produced agreement. Two smaller
         divergences sat underneath it. The gate now lives in
         `tests/orchestrator-parity.test.ts`, which reimplements the old cluster
         from the same primitives and asserts both choose identically across
         6,480 turn shapes — a CI failure rather than weeks of log-reading, and
         it caught a real defect on its first run.

         One difference is intended and asserted there: a coding question typed
         in Chat mode now takes a code lane. */
      const turnPlan = planTurn({
        request: lastUserText,
        mode,
        effort: effortLevel,
        complex: complexRoute,
        hasFiles,
        hasImageAttachments: currentImageAttachments.length > 0,
        longContext: modelMessages.length > LONG_CONTEXT_TURNS,
        tools,
        availability,
        /* The input whose absence made the comparison above meaningless: the
           cluster branches on the pinned preset, so a planner that could not
           see it could never agree with the cluster. */
        preset: resolvedPreset,
        meteredAllowed,
        /* Unconditional now. Gating on `lane === 4` here used *this* lane to
           filter an input to a planner that picks its own; the gate belongs
           inside, against the lane actually chosen. */
        discovered: cachedRoute("coding")
      });
      /* The two non-model plan kinds, neither of which should reach here: the
         image pipeline returned several hundred lines above, and an
         unconfigured deployment is refused before any of this runs. They are
         handled rather than asserted away, because "should be unreachable" is a
         claim about code that changes, and the cost of being wrong is a thrown
         request where a working answer was available. `generalRoute` is what
         this route chose for itself before the planner existed. */
      const route = turnPlan.kind === "model" ? turnPlan.route : generalRoute;
      const lane = turnPlan.kind === "model" ? turnPlan.lane : laneFromInputs;
      console.log(`Navi Soul plan: ${describePlan(turnPlan)} | serving: lane ${lane}, ${engineName(route)}`);

      /* Auto-routing has to be visible or it is a black box: when it picks
         badly there is otherwise no way to tell that it did. */
      /* The plan, shown rather than only acted on. Navi Soul has been making one
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
      const messagesFor = async (budget: number): Promise<ModelMessage[]> => {
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

      /* The system prompt, built per attempt because it names the tools that
         attempt can actually call. Lifted out of the `streamText` call so its
         size can be measured before the request is sent — it is the largest
         single contributor to a turn and nothing could previously see it. */
      /* Obeyed at the prompt as well as at the route.
         `planTurn` has always returned the optional blocks a turn earned, and
         nothing read the list — so `capability-brief`, whose whole job is to
         tell the model what is switched on right now, was decided by a function
         no turn ever reached. Built once per turn rather than per attempt: the
         answer cannot change between a failed route and its fallback, and the
         retry path calls this for every one of them. */
      const planBlocks = turnPlan.kind === "model" ? turnPlan.promptBlocks : [];
      const capabilities = planBlocks.includes("capability-brief")
        ? capabilitySnapshotFor({ availability, toolsetContext })
        : undefined;

      const blocksFor = (attemptToolNames: string[], referenceBudget: number): PromptBlock[] => systemPromptBlocks({ effort: effortLevel, productMode: mode, mode: dispatch === "code" ? "code" : "chat", tools, artifactRequested, request: lastUserText, promptBlocks: planBlocks, capabilities, retrieved: retrieval?.block, documents: documents.length ? documentsBlock(documents) : undefined, threadSummary, mcpContext, toolNames: attemptToolNames, userContext, isOwner, memoryContext, playbookContext, constraints: constraintBlock(plan), capabilityRequested, spoken: spokenReply, spokenBy, artifactAudit: artifactAuditBlock, referenceBudget });
      const systemFor = (attemptToolNames: string[], referenceBudget: number): string =>
        blocksFor(attemptToolNames, referenceBudget).map((block) => block.text).join("\n\n");

      /**
       * One routed, preflighted, non-streaming call.
       *
       * The mission loop and the learning loop both need a model call that
       * returns a whole string rather than a stream, and neither may own
       * routing: a second router would be a second set of decisions about
       * which providers cost money. So this is the same machinery an ordinary
       * turn uses — the route this turn already chose, the same prompt blocks,
       * the same preflight — with the stream taken off.
       *
       * Mechanical purposes take the fast route. Splitting a brief into steps
       * and checking whether an answer satisfies its request are both work the
       * cheapest configured model does as well as the strongest, and a mission
       * that spent its strongest route on bookkeeping would be slower for no
       * better answer.
       */
      const callEngineOnce = async (prompt: string, purpose: "decompose" | "step" | "verify" | "revise" | "fast"): Promise<string> => {
        const subRoute = purpose === "step" || purpose === "revise"
          ? route
          : selectDirectRoute({ preset: resolvedPreset, availability, hasFiles: false, tools, complex: false });
        const subCeiling = requestTokenCeiling(PROVIDERS[subRoute.provider]) - CEILING_SAFETY_MARGIN;
        const subMessages: ModelMessage[] = [{ role: "user", content: prompt }];
        /* Whatever the ceiling has left once the prompt is counted, floored at
           the shortest reply worth making and capped like any other reply. */
        const outputReserve = Math.max(
          MIN_OUTPUT_TOKENS,
          Math.min(MAX_OUTPUT_TOKENS, subCeiling - estimateTextTokens(prompt) - PROMPT_RESERVE_TOKENS)
        );
        const outcome = preflightPayload({
          route: subRoute,
          availability,
          blocks: blocksFor([], Math.max(0, subCeiling - PROMPT_RESERVE_TOKENS)),
          tools: {},
          messages: subMessages,
          outputReserve
        });
        if (!outcome.ok) throw new Error(outcome.reason);
        const reply = await generateText({
          model: createProviderModel(outcome.route, origin),
          system: outcome.system,
          messages: outcome.messages,
          maxOutputTokens: outputReserve,
          maxRetries: 1,
          abortSignal: request.signal
        });
        return reply.text;
      };

      /**
       * Lessons into the store the `learning` and `reflection` tools already
       * write, behind the gate they already use.
       *
       * Not a second memory: `rememberSkill` is the write, and the
       * `LESSON_PREFIX` naming convention is what makes a row render in future
       * prompts as something Navi Soul worked out rather than as an instruction
       * the user gave. Both belong to `learned-skills.ts`; this only adapts the
       * loop's shape to them. Signed out there is nowhere to keep a lesson, so
       * nothing is written and nothing is claimed.
       */
      const canKeepLessons = Boolean(mayRemember && clerkToken && clerkUserId && learnedSkillsConfigured());
      const storeLessons = async (lessons: Lesson[]): Promise<number> => {
        if (!canKeepLessons) return 0;
        const { rememberSkill } = await import("@/lib/memory/learned-skills");
        let stored = 0;
        for (const lesson of lessons) {
          const result = await rememberSkill(clerkToken!, clerkUserId!, {
            name: `${LESSON_PREFIX} ${lesson.statement.slice(0, 60)}`.slice(0, 120),
            description: `Learned from ${lesson.source}.`,
            instructions: lesson.statement,
            sourceUrl: /^https?:\/\//i.test(lesson.source) ? lesson.source : undefined
          });
          if ("skill" in result) stored += 1;
          else console.warn("Navi Soul could not keep a lesson:", result.error);
        }
        return stored;
      };

      /* ── The learning path ──────────────────────────────────────────────
         "Learn this:" and a pasted article, or a link. One engine call turns
         the content into durable one-sentence lessons, which go to the store
         above and reach future turns through the block that already renders it.

         The reply says what was kept and repeats the loop's notes verbatim. The
         YouTube note is the reason for that rule: when a video cannot be read it
         asks for the transcript, which is the honest answer — nothing here
         watches a video, a model reads text. */
      const learningUrl = /https?:\/\/\S+/.exec(lastUserText)?.[0] ?? null;
      if (wantsLearning(lastUserText) || (learningUrl && /\b(learn|remember|study|watch|read)\b/i.test(lastUserText))) {
        writer.write(statusChunk({ stage: "gather", detail: "Reading what to learn." }));
        const report = await ingestContent(
          learningUrl
            ? { kind: "url", value: learningUrl }
            : { kind: "text", value: lastUserText },
          {
            runEngine: (prompt) => callEngineOnce(prompt, "fast"),
            /* `readUrl`, not `readUrlAsText`: the learning loop has to be able
               to tell a page from an explanation of why there is no page. */
            fetchPage: (url) => readUrl(url, { signal: request.signal }),
            storeLessons,
            onProgress: (label) => writer.write(statusChunk({ stage: "draft", detail: label }))
          }
        );

        const lines: string[] = [];
        if (report.stored) {
          lines.push(`Learned and kept ${report.stored} thing${report.stored === 1 ? "" : "s"}:`, "");
          for (const lesson of report.lessons.slice(0, report.stored)) lines.push(`- ${lesson.statement}`);
        } else if (report.lessons.length && !canKeepLessons) {
          lines.push(`I found ${report.lessons.length} thing${report.lessons.length === 1 ? "" : "s"} worth keeping, but there is nowhere to keep them while you are signed out:`, "");
          for (const lesson of report.lessons) lines.push(`- ${lesson.statement}`);
        }
        /* Verbatim, and never summarised into a cheerier sentence: a note here
           is the difference between "I watched it" and "paste the transcript". */
        for (const note of report.notes) lines.push(lines.length ? `\n${note}` : note);

        const learningTextId = generateId();
        writer.write({ type: "text-start", id: learningTextId });
        for (const chunk of splitLargePayload(lines.join("\n") || "Nothing durable was found to keep.")) {
          writer.write({ type: "text-delta", id: learningTextId, delta: chunk });
        }
        writer.write({ type: "text-end", id: learningTextId });
        writer.write(statusChunk({ stage: "complete", detail: "Response complete." }));
        return;
      }

      /* ── The mission path ───────────────────────────────────────────────
         A request that is plainly several pieces of work is run as several
         pieces of work: decomposed, executed with the on-device skills tried
         before any engine, checked once, and combined into a single answer.

         What the user gets is that answer. The steps appear as activity chips
         while the mission runs and nowhere else — a reply that narrates its own
         process is a transcript, not an answer, and the person asked for the
         work rather than a report on it.

         A mission that fails outright is not fatal: the turn falls through to
         the ordinary streaming path below and is answered the usual way. */
      if (shouldRunAsMission(lastUserText, effortLevel)) {
        let report: MissionReport | null = null;
        try {
          report = await runMission(lastUserText, {
            runEngine: (prompt, purpose) => callEngineOnce(prompt, purpose),
            /* The zero-token layer. `decideLocally` rather than the full skill
               library because this runs on the edge, where the library's
               "use client" module must never be imported. */
            runSkill: async (query) => {
              const decision = decideLocally(query);
              return decision.route === "local" ? { text: decision.response, skill: "navi-soul.local" } : null;
            },
            onProgress: (label) => writer.write(statusChunk({ stage: "draft", detail: label }))
          }, {
            /* High effort buys more steps, not unlimited ones. An autonomous
               loop without a meter is how a free tier is spent on one message. */
            maxEngineCalls: effortLevel === "high" ? 12 : 8
          });
        } catch (error) {
          console.warn("Navi Soul mission failed; answering as an ordinary turn:", error);
        }

        if (report && report.answer.trim()) {
          for (const note of report.notes) console.info("Navi Soul mission:", note);
          console.info(`Navi Soul mission ${report.status}: ${report.engineCalls} engine calls, ${report.skillHits} answered on device, verified ${String(report.verified)}.`);

          /* Mined from the report rather than from a model: it already says what
             failed, what was revised, and what ran out of budget, so this costs
             nothing. Signed out it is skipped in silence — there is nowhere to
             keep a lesson, and saying so would be a notice about the app in the
             middle of an answer about something else. */
          const mined = learnFromMission({
            status: report.status,
            request: lastUserText,
            engineCalls: report.engineCalls,
            verified: report.verified,
            notes: report.notes,
            failedSteps: report.steps.filter((step) => step.source === "failed").map((step) => step.step.title)
          });
          if (mined.length && canKeepLessons) {
            void storeLessons(mined).catch((error) => console.warn("Navi Soul could not keep its mission lessons:", error));
          }

          /* A spent budget is reported to the user, because the answer is
             genuinely partial and silence would present it as complete. Every
             other note is for the log — they are about how the answer was made,
             not about what it says. */
          const body = report.status === "budget-exhausted"
            ? `${report.answer}\n\n> ${report.notes[report.notes.length - 1] ?? "The mission's engine budget was spent before every step finished."}`
            : report.answer;

          /* Through the same gate the streamed path uses: a mission can produce
             an artifact, and an unvalidated payload is exactly what the gate
             exists to hold back. */
          const gate = createArtifactGate();
          const missionTextId = generateId();
          writer.write({ type: "text-start", id: missionTextId });
          for (const chunk of splitLargePayload(body)) {
            const safe = gate.push(chunk);
            if (safe) writer.write({ type: "text-delta", id: missionTextId, delta: safe });
          }
          const held = gate.flush();
          if (held) writer.write({ type: "text-delta", id: missionTextId, delta: held });
          writer.write({ type: "text-end", id: missionTextId });
          writer.write(statusChunk({ stage: "complete", detail: "Response complete." }));
          return;
        }
      }

      /* Health-ordered: a provider that has been failing across recent
         requests goes to the back of the line instead of charging every turn
         its timeout. Deprioritized, never dropped.

         Taken from the plan when there is one — `planTurn` orders the primary
         and its alternates together, in one pass over the same health store, so
         recomputing it here would be a second answer to a question already
         answered. The inline form stays as the safety net for a non-model plan,
         matching the `route` fallback above. */
      const attempts = turnPlan.kind === "model"
        ? [turnPlan.route, ...turnPlan.fallbacks]
        : orderRoutesByHealth([
          route,
          ...fallbackRoutes({ primary: route, availability, complex: complexRoute })
        ]);
      /* The floor, appended after the health ordering rather than inside it:
         it is the answer of last resort, so it must stay last however badly the
         free routes have been behaving. Skipped when it is already in the list,
         and absent entirely unless a frontier model is named. */
      const floor = turnPlan.kind === "model" ? turnPlan.lastResort : lastResortRoute(availability, meteredAllowed);
      if (floor && !attempts.some((candidate) => candidate.model === floor.model)) attempts.push(floor);
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
        const attemptTools = attemptToolNames.length ? availableTools : {};

        /* Everything the reference blocks are competing with, so what is left
           over is what they may spend. Computed before the prompt is built
           rather than measured after, because the budget is an input to
           building it — see `fitReferenceBlocks`.

           The reserve covers the base prefix (~1,000 tokens), the short
           per-request instruction lines (~500), room for a real conversation
           (~1,000), and the shortest reply worth streaming. On a roomy route
           this leaves far more than the blocks can use and nothing is trimmed;
           on the 8,000-token free tier it leaves about 2,000, which buys the
           two that matter most instead of failing the request outright. */
        const provisionalCeiling = requestTokenCeiling(PROVIDERS[attempt.provider]) - CEILING_SAFETY_MARGIN;
        const referenceBudget = Math.max(0, provisionalCeiling - PROMPT_RESERVE_TOKENS - estimateToolTokens(attemptTools));
        const attemptSystem = systemFor(attemptToolNames, referenceBudget);

        /* Size the request to what this route will actually take, before
           sending it. A turn of 20,805 tokens was offered to a route whose
           entire per-minute allowance is 8,000 — a request that could not
           succeed, could not be retried into succeeding, and failed over to
           three other routes that were never the problem.

           Two numbers matter and neither was being read. The ceiling is the
           provider's own limit on one request; on a free tier that is its
           throughput allowance, not its context window. The fixed cost is the
           system prompt plus the tool schemas, which is most of the payload on
           an ordinary turn and which the old budget did not count at all. */
        const ceiling = provisionalCeiling;
        const fixed = estimateTextTokens(attemptSystem) + estimateToolTokens(attemptTools);
        /* Still bounded by the window share as well: a provider can have room
           to spare and still answer worse for being handed a huge history. */
        const inputBudget = Math.min(
          Math.floor(PROVIDERS[attempt.provider].contextWindow * CONTEXT_INPUT_SHARE),
          ceiling - fixed - MIN_OUTPUT_TOKENS
        );

        /* Checked before compaction rather than left to the arithmetic below.
           A route with no room for the conversation would otherwise reach
           `streamText` with an empty message list — a request carrying the
           whole system prompt and no question — which is a worse failure than
           the one being prevented, because it returns an answer. */
        const tooSmall = (weighed: number) => {
          console.info(`Navi Soul skipped ${attempt.label}: ${describeRequestSize({ system: estimateTextTokens(attemptSystem), tools: estimateToolTokens(attemptTools), messages: Math.max(0, weighed - fixed), output: 0, total: weighed }, ceiling)}`);
          lastFailure ??= new Error(`This turn needs more room than any configured route will accept (${weighed} tokens of prompt).`);
        };
        if (inputBudget <= 0) { tooSmall(fixed); continue; }

        const attemptMessages = await messagesFor(inputBudget);

        /* What is left over, capped by the ceiling on any one reply. This is
           the line that broke production: a flat 8,000 was reserved on every
           call, which on the 8,000-token route was the entire allowance — so
           even a one-word question was refused before the prompt was counted. */
        const input = measureRequest({ system: attemptSystem, tools: attemptTools, messages: attemptMessages, output: 0 });
        const attemptOutputTokens = Math.min(MAX_OUTPUT_TOKENS, ceiling - input.total);

        /* Compaction is best-effort — it returns the conversation unchanged
           when the summariser is down — so the decision is made on what the
           payload actually weighs now, not on what the budget hoped it would.
           Skipping costs one round trip that was going to be refused anyway. */
        if (attemptOutputTokens < MIN_OUTPUT_TOKENS) { tooSmall(input.total); continue; }
        console.info(`Navi Soul sending to ${attempt.label}: ${describeRequestSize({ ...input, output: attemptOutputTokens, total: input.total + attemptOutputTokens }, ceiling)}`);

        /* The last measurement before the stream opens, and the only one that
           can still change the payload. Everything above sizes the request for
           this route; this checks the result against what the provider itself
           will accept and, if it still does not fit, drops optional blocks,
           trims tools, and truncates history in that order — then reroutes to
           a roomier free lane rather than sending a request that cannot
           succeed. Compaction upstream is untouched: it runs first and only
           leaves this less to do. */
        const outcome = preflightPayload({
          route: attempt,
          availability,
          blocks: blocksFor(attemptToolNames, referenceBudget),
          tools: attemptTools,
          messages: attemptMessages,
          outputReserve: attemptOutputTokens
        });
        if (!outcome.ok) {
          /* The same friendly path a route too small for the turn already
             takes: name the largest contributor in the log, keep the failure
             for the final message, and let the next attempt try. */
          console.warn("Navi Soul preflight refused:", outcome.reason);
          lastFailure ??= new Error(`This turn needs more room than any configured route will accept (${outcome.size.total} tokens of prompt).`);
          continue;
        }
        const flight = outcome;
        const flightRoute = flight.route;
        const flightMetered = flightRoute.provider === "deepseek";
        if (flight.rerouted) {
          console.info(`Navi Soul rerouted to ${flightRoute.label} for room: ${describeRequestSize(flight.size, ceiling)}`);
        }
        if (flight.droppedBlocks.length || flight.removedTools || flight.removedMessages || flight.clippedLastMessage) {
          console.info(`Navi Soul shrank the request for ${flightRoute.label}: dropped ${flight.droppedBlocks.join(", ") || "no blocks"}, ${flight.removedTools} tools, ${flight.removedMessages} earlier messages${flight.clippedLastMessage ? ", and clipped the middle of the request itself" : ""}.`);
        }

        /* Which engine is answering, said out loud. Written before the stream
           rather than after it, so a reply that fails halfway still carries the
           note explaining which engine produced the half — the case where
           knowing is worth the most. `recovered` marks a reply that an earlier
           route dropped: an answer arriving from the second or third attempt is
           usually the one someone is about to describe as "worse", and that is
           the explanation. */
        writer.write({
          type: "data-engine",
          /* The engine that is actually answering. A preflight reroute changes
             which one that is, and naming the route we intended rather than the
             one we used would make the note a guess. */
          data: { engine: engineName(flightRoute), effort: EFFORT_LABELS[effortLevel], recovered: index > 0 || flight.rerouted } satisfies NaviEngineNote
        } as never);

        const result = streamText({
        model: createProviderModel(flightRoute, origin),
        system: flight.system,
        messages: flight.messages,
        ...(attemptToolNames.length
          ? { tools: flight.tools, stopWhen: stepCountIs(dispatch === "code" ? MAX_CODE_TOOL_STEPS : MAX_TOOL_STEPS) }
          : {}),
        maxOutputTokens: attemptOutputTokens,
        maxRetries: 1,
        timeout: { totalMs: 50_000, chunkMs: 14_000 },
        abortSignal: request.signal,
        experimental_transform: smoothStream({ delayInMs: 26, chunking: "word" }),
        onError: ({ error }) => console.error("Navi Soul provider stream failed:", error)
      });
      /* Billed from what the response actually reported, not from an estimate.
         Cache hits and misses differ in price by roughly fifty times, so a
         guess based on request counts would be wrong by orders of magnitude. */
      /* Keyed to the route that answered, not the one that was planned. The
         preflight only ever reroutes onto a free lane, so this can turn a
         metered turn free but never the reverse — and billing the ledger for a
         model that was not called would be a spending record of a request that
         never happened. */
      if (flightMetered) void meterSpend(result, flightRoute.model);
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
        /* Pages read this turn now count. They rank below files deliberately —
           a repository file is what this app holds, a fetched page is somebody
           else's claim — but for a research turn they are the only grounding
           there has ever been, and before this the critique had nothing to
           check a cited URL against. */
        const grounding = groundingFor({ retrieved: retrieval?.block, sources: fetchedSources });
        const shouldCritique = plan.needsReview && critiqueAllowed({ lane, grounding });
        if (plan.needsReview && !shouldCritique) {
          console.info("Navi Soul skipped the critique pass:", skipReason({ lane, grounding }));
        }
        if (shouldCritique) {
          writer.write(statusChunk({ stage: "draft", detail: "Drafting the implementation." }));
          let draft: string;
          try {
            draft = await result.text;
            markProviderSuccess(flightRoute.provider);
          } catch (error) {
            /* Nothing was shown, so another provider may still answer. */
            markProviderFailure(flightRoute.provider, error);
            lastFailure = error;
            continue;
          }
          if (!draft.trim()) { lastFailure = new Error("The response came back empty."); continue; }
          const spent = Date.now() - requestStartedAt;
          const reviewBudget = REQUEST_BUDGET_MS - spent - REVIEW_DELIVERY_RESERVE_MS;
          writer.write(statusChunk({ stage: "verify", detail: "Checking it against the constraints." }));
          /* Loop, not a single pass. A revision used to go to the user
             unchecked — the one output nobody verified was the one produced by
             the step whose job is verification. */
          const review = await reviewUntilSound({
            draft,
            request: lastUserText,
            plan,
            origin,
            budgetMs: reviewBudget,
            abortSignal: request.signal,
            onPass: (round) => writer.write(statusChunk({
              stage: "verify",
              detail: round === 1 ? "Checking it against the constraints." : `Re-checking the correction (pass ${round}).`
            }))
          });
          const finalText = review.text;
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
            markProviderFailure(flightRoute.provider, failure);
            lastFailure = failure ?? new Error("The provider produced no content.");
            continue;
          }

          markProviderSuccess(flightRoute.provider);
          reader.releaseLock();
          for (const chunk of preamble) writer.write(chunk as never);
          writer.merge(stream);
          /**
           * Why an answer stopped, which nothing in this app has ever asked.
           *
           * `finishReason` appears nowhere in the codebase, so a reply cut off
           * by the output cap streamed mid-sentence with no marker, no retry,
           * and no record — indistinguishable from a model that simply had
           * little to say. `readUntilCommitted` catches an *empty* stream and
           * an *errored* one; a truncated one looks like success to every check
           * the route makes.
           *
           * Logged rather than shown, deliberately and for now. Appending a
           * marker means writing to the stream after `merge` has been handed
           * it, which is the one path in this app where getting the lifecycle
           * subtly wrong breaks every answer rather than one. The frequency
           * decides whether that risk is worth taking, and the frequency has
           * never been observable. This makes it observable first.
           */
          /* `finishReason` is a PromiseLike, so it is awaited rather than
             chained — and the whole thing is detached, because the reason is
             diagnostics and must never be able to fail a delivered answer. */
          void (async () => {
            try {
              if ((await result.finishReason) === "length") {
                console.warn(
                  `Navi Soul answer truncated by the output cap: ${engineName(flightRoute)}, `
                  + `${attemptOutputTokens} tokens reserved, lane ${lane}, ${dispatch} dispatch.`
                );
              }
            } catch { /* Never a reason to fail an answer already delivered. */ }
          })();
          return;
        } catch (error) {
          markProviderFailure(flightRoute.provider, error);
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
