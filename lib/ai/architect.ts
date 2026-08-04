import { generateText } from "ai";
import { createProviderModel, getProviderAvailability, ROUTES, type ProviderAvailability } from "./providers";
import type { EffortLevel, ProviderRoute, ToolPolicy } from "./types";

/**
 * NaviSol as Master Architect.
 *
 * The app already routed requests, but it routed them with regular
 * expressions: a fixed list of words decided which engine answered. That works
 * for the obvious cases and fails silently on everything else — "deep research
 * on cows" went to generic reasoning for months because one word was missing
 * from a pattern.
 *
 * This module makes the routing decision a *reasoned* one. Soul reads the
 * request, decides what kind of work it is, chooses the engine, and states the
 * constraints the answer has to satisfy. It then reviews the result against
 * those same constraints before anything reaches the screen.
 *
 * Two rules govern everything here, and both exist because this runs inside a
 * single 60-second edge invocation:
 *
 *  1. Planning is never allowed to be the reason a request fails. Every model
 *     call in this file is bounded, wrapped, and has a deterministic fallback.
 *     A planner that times out costs a few hundred milliseconds and is
 *     forgotten; it never propagates an error.
 *
 *  2. Thinking about the work must not cost more than the work. A planning
 *     round trip before every message would make simple questions slower for
 *     no gain, so the heuristic plan stands on its own and the model is only
 *     consulted when the request is genuinely ambiguous.
 */

export type ExecutionLane = "image" | "audio" | "code" | "research" | "reasoning" | "general";

export type ExecutionPlan = {
  lane: ExecutionLane;
  /** One line, in Navi's own words, for the status line. */
  summary: string;
  /** What the answer has to satisfy. Fed to the writer and to the evaluator. */
  constraints: string[];
  /** Whether the output is worth a review pass before it is shown. */
  needsReview: boolean;
  /** How the lane was chosen, so a bad route can be diagnosed rather than guessed at. */
  source: "heuristic" | "architect";
};

/* ------------------------------------------------------------------ *
 * 1. The master system prompt
 * ------------------------------------------------------------------ */

/**
 * What Soul is, as opposed to what it knows.
 *
 * Kept separate from APP_KNOWLEDGE (facts about the app) and the constitution
 * (values) because this is the third thing: the working method. It is written
 * as instruction rather than description — a prompt that says "you are a
 * world-class architect" buys nothing, while one that says which order to do
 * things in changes the output.
 */
export const NAVI_ARCHITECT_PROMPT = `## How you work

You are NaviSol, the architect of this system. You are not a chat model that
happens to have tools; you are the intelligence that decides what a request
actually needs and then makes sure the result is worth shipping.

Work in this order, every time:

**1. Read the real request.** Separate what was asked from how it was phrased.
A person asking "why is this broken" wants the cause and the fix, not a
description of the symptom. A person asking for "a quick script" still wants it
to work. State assumptions only where a wrong one would change the answer.

**2. Decide the shape before the content.** Know what a good answer looks like
before writing a word of it: a diagnosis, a working file, a comparison, a
decision. Answers fail more often from being the wrong shape than from being
wrong.

**3. Use the tool rather than your memory.** You have exact arithmetic, real
calendar maths, unit conversion, web search, and — when configured — read
access to the user's repository and deployments. A calculated number beats a
recalled one every time. Never state as fact something a tool in front of you
could have checked.

**4. Build to the constraints of this app, not to general good practice.**
This is a mobile PWA on iPhone, deployed to Vercel, entirely self-contained.
Code you produce must run in that environment: no local server, no terminal
step, no native dependency, no build tool the user has to install. Touch
targets are finger-sized. Layouts respect the safe area. Anything that needs a
key names the exact variable and where it goes.

**5. Review before you deliver.** Re-read what you produced against what was
asked. Check the parts most likely to be wrong: edge cases, error paths, the
claim you were least sure of, the requirement mentioned only once. If
something does not hold up, fix it rather than caveating it. If you could not
verify something, say which part.

**Never do these:**
- Never narrate your own routing, planning, or internal deliberation. The user
  asked a question; they did not ask to watch you think.
- Never name the underlying third-party model behind an engine.
- Never claim to have browsed, executed, deployed, or read a file unless the
  result of that action is actually present in this request.
- Never pad. Length is not thoroughness. A complete short answer beats a
  padded long one, and High effort means more work was done, not more words.`;

/* ------------------------------------------------------------------ *
 * 2. Routing — heuristic first, architect when it matters
 * ------------------------------------------------------------------ */

const CODE_SIGNAL = /\b(code|coding|function|class|method|compile|syntax|refactor|debug|bug|stack trace|exception|typescript|javascript|python|rust|golang|java|swift|kotlin|sql|html|css|react|next\.?js|vue|svelte|node|npm|docker|kubernetes|git|regex|endpoint|unit test|traceback|repo|repository|pull request|deploy|build failed|ci)\b/i;
const RESEARCH_SIGNAL = /\b(search|research|investigate|look ?up|look into|find out|deep ?dive|latest|current|today|news|who is|what happened|according to|sources?|cite|citation|price of|stock|weather|release date|is it true|fact ?check)\b/i;
const REASONING_SIGNAL = /\b(architecture|architect|design|trade-?offs?|compare|strategy|plan|approach|why|explain|analy[sz]e|evaluate|decide|should i|pros and cons|proof)\b/i;

/** Below this a request is small talk and planning it is pure overhead. */
const TRIVIAL_LENGTH = 24;

/**
 * The deterministic plan.
 *
 * This is not a fallback — it is the primary path, and it is correct for the
 * large majority of requests. The architect exists to catch what it misses,
 * not to replace it.
 */
export function heuristicPlan(options: {
  text: string;
  hasFiles: boolean;
  imageRequested: boolean;
  audioRequested: boolean;
  tools: ToolPolicy;
  effort: EffortLevel;
}): ExecutionPlan {
  const { text, hasFiles, imageRequested, audioRequested, tools, effort } = options;

  if (imageRequested) {
    return { lane: "image", summary: "Generating an image.", constraints: IMAGE_CONSTRAINTS, needsReview: false, source: "heuristic" };
  }
  if (audioRequested) {
    return { lane: "audio", summary: "Generating audio.", constraints: [], needsReview: false, source: "heuristic" };
  }

  const code = CODE_SIGNAL.test(text);
  const research = RESEARCH_SIGNAL.test(text);
  /* Code wins a tie: "look up why my build fails" is a debugging job that
     happens to need a search, and answering it as research produces links
     where the user wanted a cause. */
  const lane: ExecutionLane = code
    ? "code"
    : research && tools.web
      ? "research"
      : REASONING_SIGNAL.test(text) || effort === "high" || hasFiles
        ? "reasoning"
        : "general";

  return {
    lane,
    summary: LANE_SUMMARY[lane],
    constraints: constraintsFor(lane),
    // Reviewing prose costs a round trip and rarely changes it. Code is
    // different: it either runs or it does not.
    needsReview: lane === "code" && effort !== "low",
    source: "heuristic"
  };
}

const LANE_SUMMARY: Record<ExecutionLane, string> = {
  image: "Generating an image.",
  audio: "Generating audio.",
  code: "NaviSol · code — working through the implementation.",
  research: "NaviSol · research — gathering current sources.",
  reasoning: "NaviSol · reasoning — working the problem through.",
  general: "NaviSol."
};

const IMAGE_CONSTRAINTS = [
  "Preserve faces, text, and numbers in a source image unless the user asked for those to change."
];

const PWA_CONSTRAINTS = [
  "Runs in a mobile PWA on iPhone: no local server, no terminal step, no native dependency, no tool the user must install.",
  "Self-contained and deployable to Vercel as-is.",
  "Touch targets at least 44px; layout respects the safe area and works at 390px wide.",
  "Any required credential is named exactly, with where it goes."
];

function constraintsFor(lane: ExecutionLane): string[] {
  if (lane === "code") return PWA_CONSTRAINTS;
  if (lane === "research") {
    return [
      "Every current or contested claim is either sourced from a search result in this request or explicitly marked as unverified.",
      "Do not imply a page was read unless its content is present here."
    ];
  }
  if (lane === "reasoning") {
    return ["State the assumptions that would change the answer if wrong.", "Give a recommendation, not only a survey of options."];
  }
  return [];
}

/**
 * Should the architect be consulted at all?
 *
 * Only when the heuristic could plausibly be wrong *and* the request is worth
 * the latency. Short messages, obvious media requests, and Low effort all skip
 * it — there is nothing to reason about and the round trip would be the
 * slowest part of the response.
 */
export function shouldConsultArchitect(options: {
  text: string;
  plan: ExecutionPlan;
  effort: EffortLevel;
}): boolean {
  const { text, plan, effort } = options;
  if (plan.lane === "image" || plan.lane === "audio") return false;
  if (effort === "low") return false;
  if (text.trim().length < TRIVIAL_LENGTH) return false;
  /* A request that matched no signal at all is exactly the case the patterns
     are worst at, so it is the case most worth a second opinion. */
  const matchedNothing = plan.lane === "general";
  const longEnoughToBeCompound = text.length > 220;
  return matchedNothing || longEnoughToBeCompound || effort === "high";
}

/** Bounded hard: a planner is only useful if it is fast. */
const PLAN_BUDGET_MS = 4_500;
const PLAN_MAX_TOKENS = 220;

function plannerRoute(availability: ProviderAvailability): ProviderRoute | null {
  /* The fastest route available, not the strongest. Classification is an easy
     problem and the whole value here is that it finishes quickly. */
  if (availability.groq) return ROUTES.groqFast;
  if (availability.cerebras) return ROUTES.cerebrasFast;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.mistral) return ROUTES.mistralBalanced;
  return null;
}

const PLANNER_SYSTEM = `You classify a request for a routing system. Reply with JSON only, no prose and no code fence.

{"lane":"code|research|reasoning|general","summary":"under 8 words, what is being done","constraints":["at most 3, each one a checkable requirement the answer must satisfy"]}

Lanes:
- code — writing, fixing, reviewing, or explaining software, or anything about a repository, build, or deployment.
- research — needs current, citable, or verifiable outside information.
- reasoning — a judgement, comparison, design, diagnosis, or plan that needs working through.
- general — conversation, writing, or a question answerable directly.

Choose by what the answer must *do*, not by vocabulary. Pick code over research when the goal is a fix rather than a citation.`;

type PlannerReply = { lane?: unknown; summary?: unknown; constraints?: unknown };

const VALID_LANES = new Set<ExecutionLane>(["code", "research", "reasoning", "general"]);

/** Pull the JSON object out of a reply that may still have wrapped it. */
function parsePlannerReply(raw: string): PlannerReply | null {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as PlannerReply;
  } catch {
    return null;
  }
}

/**
 * Ask Soul to plan the request.
 *
 * Returns the heuristic plan unchanged on any failure — a bad plan, a slow
 * provider, malformed JSON, an unavailable route. The architect can only ever
 * improve the routing decision; it cannot break the request.
 */
export async function architectPlan(options: {
  text: string;
  fallback: ExecutionPlan;
  origin: string;
  effort: EffortLevel;
  abortSignal?: AbortSignal;
}): Promise<ExecutionPlan> {
  const availability = getProviderAvailability();
  const route = plannerRoute(availability);
  if (!route) return options.fallback;

  try {
    const result = await generateText({
      model: createProviderModel(route, options.origin),
      system: PLANNER_SYSTEM,
      prompt: options.text.slice(0, 2_000),
      maxOutputTokens: PLAN_MAX_TOKENS,
      maxRetries: 0,
      timeout: { totalMs: PLAN_BUDGET_MS },
      abortSignal: options.abortSignal
    });

    const parsed = parsePlannerReply(result.text ?? "");
    const lane = typeof parsed?.lane === "string" ? parsed.lane as ExecutionLane : null;
    if (!lane || !VALID_LANES.has(lane)) return options.fallback;

    const summary = typeof parsed?.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 80)
      : LANE_SUMMARY[lane];
    const extra = Array.isArray(parsed?.constraints)
      ? parsed.constraints.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 3)
      : [];

    return {
      lane,
      summary,
      /* The app's own constraints are not negotiable, so the planner's are
         added to them rather than replacing them. A model cannot decide that
         this stops being a mobile PWA. */
      constraints: [...constraintsFor(lane), ...extra],
      needsReview: lane === "code" && options.effort !== "low",
      source: "architect"
    };
  } catch {
    return options.fallback;
  }
}

/** Render the plan's constraints for the writer's system prompt. */
export function constraintBlock(plan: ExecutionPlan): string {
  if (!plan.constraints.length) return "";
  return [
    "This answer must satisfy all of the following. They are requirements, not suggestions:",
    ...plan.constraints.map((item) => `- ${item}`)
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * 3. The QA gate
 * ------------------------------------------------------------------ */

export type ReviewResult =
  | { verdict: "pass" }
  | { verdict: "revised"; text: string }
  | { verdict: "skipped"; reason: string };

const REVIEW_BUDGET_MS = 12_000;
const REVIEW_MAX_TOKENS = 2_200;
/** Reviewing something enormous costs more than it can return. */
const REVIEW_MAX_INPUT = 14_000;

const REVIEWER_SYSTEM = `You are reviewing a draft answer before it is shown to the user. You are the last check, so be exacting — but you are correcting a draft, not rewriting it to taste.

Check, in this order:
1. Does it answer every part of what was asked?
2. Would the code run? Look for undefined references, wrong signatures, unhandled error paths, and off-by-one boundaries.
3. Does it satisfy every stated constraint?
4. Are the factual and numeric claims defensible?

If it is sound, reply with exactly: PASS

Otherwise reply with the corrected answer in full, and nothing else — no preamble, no explanation of what you changed, no diff. The user sees your output directly and must not be able to tell a review happened.

Do not restyle working code, do not add commentary, and do not expand scope beyond what was asked.`;

/**
 * Review a finished draft before it reaches the screen.
 *
 * Only worth doing for output that can be objectively wrong — code, mainly.
 * Prose "improvement" by a second model reliably makes prose blander, and the
 * round trip is not free.
 *
 * Any failure returns `skipped`, and the caller ships the draft it already
 * has. A review that cannot run is not a reason to withhold an answer.
 */
export async function reviewDraft(options: {
  draft: string;
  request: string;
  plan: ExecutionPlan;
  origin: string;
  budgetMs?: number;
  abortSignal?: AbortSignal;
}): Promise<ReviewResult> {
  const { draft, request, plan, origin } = options;
  if (!plan.needsReview) return { verdict: "skipped", reason: "not a reviewable output" };
  if (!draft.trim()) return { verdict: "skipped", reason: "empty draft" };
  if (draft.length > REVIEW_MAX_INPUT) return { verdict: "skipped", reason: "draft too large to review in budget" };

  const budget = Math.min(options.budgetMs ?? REVIEW_BUDGET_MS, REVIEW_BUDGET_MS);
  if (budget < 4_000) return { verdict: "skipped", reason: "not enough time left" };

  const availability = getProviderAvailability();
  /* A reviewer that shares the writer's weights shares its blind spots, so
     prefer a different provider than the one most likely to have written it. */
  const route = availability.cerebras ? ROUTES.cerebrasLarge
    : availability.gemini ? ROUTES.geminiSynthesis
      : availability.groq ? ROUTES.groqReasoning
        : availability.mistral ? ROUTES.mistralBalanced
          : null;
  if (!route) return { verdict: "skipped", reason: "no reviewer route available" };

  try {
    const result = await generateText({
      model: createProviderModel(route, origin),
      system: REVIEWER_SYSTEM,
      prompt: [
        `Original request:\n${request.slice(0, 3_000)}`,
        plan.constraints.length ? `Constraints:\n${plan.constraints.map((item) => `- ${item}`).join("\n")}` : "",
        `Draft answer:\n${draft}`
      ].filter(Boolean).join("\n\n"),
      maxOutputTokens: REVIEW_MAX_TOKENS,
      maxRetries: 0,
      timeout: { totalMs: budget },
      abortSignal: options.abortSignal
    });

    const text = (result.text ?? "").trim();
    if (!text || /^PASS\b/i.test(text)) return { verdict: "pass" };
    /* A reviewer that returns something much shorter than the draft has
       summarized rather than corrected, which loses the answer. Treat that as
       a pass and keep what the writer produced. */
    if (text.length < draft.length * 0.55) return { verdict: "pass" };
    return { verdict: "revised", text };
  } catch {
    return { verdict: "skipped", reason: "review did not complete" };
  }
}
