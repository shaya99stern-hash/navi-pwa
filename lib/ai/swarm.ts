import { generateText, streamText, type ModelMessage } from "ai";
import { createProviderModel, fallbackRoutes, getProviderAvailability, selectSynthesisRoute } from "./providers";
import {
  buildSwarmRoutePlan,
  classifySwarmTask,
  type SwarmEffort,
  type SwarmProfile,
  type SwarmTask
} from "./swarm-router";
import { createArtifactGate } from "./artifact-gate";
import type { NaviStreamStatus, ResponseStyle, ToolPolicy } from "./types";
import { APP_KNOWLEDGE } from "./app-knowledge";
import { NAVI_CONSTITUTION } from "./navi-constitution";

const MAX_COUNCIL_TOKENS = 950;
const MAX_SYNTHESIS_TOKENS = 2_100;
/**
 * A correction is a paragraph, not a second answer. Capping it low is the
 * cheapest guard against a verifier that ignores the instruction and rewrites.
 */
const MAX_CORRECTION_TOKENS = 400;
const MAX_ARTIFACT_TOKENS = 5_000;

/**
 * The whole pipeline has to finish inside one edge invocation.
 *
 * Three stages ran back to back on fixed 13s/18s/18s timeouts — 49 seconds of
 * model time before the answer had even begun streaming, inside a 60-second
 * limit. Any real-world slowness pushed it over and the request died with
 * nothing to show, which is exactly what High effort was doing.
 *
 * So the budget is now shared and tracked. Each stage gets what is actually
 * left rather than what it would like, and a stage with too little time to
 * finish is skipped rather than started and killed.
 */
const TOTAL_BUDGET_MS = 44_000;
/** Under this a stage cannot return anything worth having, so skip it. */
const MIN_STAGE_MS = 5_500;
/** Kept back so the finished answer has time to reach the client. */
const DELIVERY_RESERVE_MS = 1_500;

type Deadline = {
  remaining: () => number;
  /** What a stage may spend, holding `reserve` back for the stages after it. */
  budget: (preferred: number, reserve: number) => number;
};

function createDeadline(totalMs: number): Deadline {
  const start = Date.now();
  const remaining = () => Math.max(0, totalMs - (Date.now() - start));
  return {
    remaining,
    budget: (preferred, reserve) => Math.min(preferred, Math.max(0, remaining() - reserve))
  };
}

const DEEP_PHASES = [
  "requirements discovery",
  "stage planning",
  "implementation execution",
  "test construction",
  "visual and output inspection",
  "document and evidence analysis",
  "continuity and recovery planning",
  "delivery and handoff"
] as const;

const DEEP_SPECIALTIES = [
  "intent and constraint preservation",
  "architecture and sequencing",
  "code, migrations, and integration",
  "tests, validation, and regressions",
  "vision, UI fidelity, and accessibility",
  "PDFs, tables, diagrams, and source evidence",
  "failure modes, rollback, and resilience",
  "operations, deployment, and maintainability",
  "completion quality and reviewer-ready output"
] as const;

const DIRECT_WORKSTREAMS = [
  "independent solver",
  "parallel alternative explorer",
  "programmatic tool planner",
  "quantitative analyst",
  "research investigator",
  "design and computer-use critic",
  "adversarial verifier",
  "editorial synthesizer"
] as const;

const DIRECT_DISCIPLINES = [
  "intent reconstruction",
  "first-principles reasoning",
  "coding and systems engineering",
  "science and mathematics",
  "knowledge work and research",
  "tool and computer-task coordination",
  "visual design and rendered-output judgment",
  "security and operational risk",
  "counterexamples and alternative hypotheses",
  "uncertainty and evidence calibration",
  "constraint tracking and contradiction detection",
  "final usefulness and token efficiency"
] as const;

/** How Navi's specialists behave as one team: shared across every stage. */
const TEAM_DOCTRINE = [
  "Operate as one team with one goal: the single most correct, most useful answer the user could receive.",
  "Think independently first; converge on evidence, never on popularity. A lone correct workstream outranks a confident majority.",
  "Disagree early, then commit: surface every conflict explicitly with its evidence so the reconciler can rule on it once — never paper over a contradiction.",
  "Re-read the user's actual words before concluding. The most common team failure is solving an adjacent problem; restate intent and constraints, then satisfy them exactly.",
  "Carry a constraint ledger: every requirement, limit, and prior decision from the conversation must survive to the final answer or be explicitly renegotiated.",
  "Prefer the checkable claim: show the computation, the code path, the counterexample, or the source; a claim no teammate could verify is a liability.",
  "Attack your own best idea once before submitting it: the strongest failure mode, the edge case, the input that breaks it.",
  "Be fast by being lean: no restating the prompt, no hedging filler, no repeated framing; spend tokens only where they change the conclusion.",
  "Finish like a professional: the final answer is decisive, complete, self-contained, and reads as one brilliant mind — never as a committee."
].join("\n");

type CompositeOptions = {
  profile: SwarmProfile;
  messages: ModelMessage[];
  requestText: string;
  effort: SwarmEffort;
  origin: string;
  style: ResponseStyle;
  tools: ToolPolicy;
  artifactRequested: boolean;
  threadSummary?: string;
  mcpContext?: string;
  onStage: (status: NaviStreamStatus) => void;
  abortSignal: AbortSignal;
};

function deepRoles(): string[] {
  return DEEP_PHASES.flatMap((phase) => DEEP_SPECIALTIES.map((specialty) => `${phase}: ${specialty}`));
}

function directRoles(): string[] {
  return DIRECT_WORKSTREAMS.flatMap((workstream) => DIRECT_DISCIPLINES.map((discipline) => `${workstream}: ${discipline}`));
}

function rolesFor(profile: SwarmProfile): string[] {
  return profile === "navi-soul-deep" ? deepRoles() : directRoles();
}

function profileLabel(profile: SwarmProfile): string {
  return "Navi Soul";
}

function styleInstruction(style: ResponseStyle): string {
  if (style === "concise") return "The user-facing answer must be compact, decisive, and free of repeated framing.";
  if (style === "detailed") return "The user-facing answer must be complete, structured, and implementation-ready without padding.";
  return "Lead with the answer, then include only the detail needed to make it useful.";
}

function artifactContract(requested: boolean): string {
  const contract = [
    "Navi artifacts execute inside an isolated browser sandbox and can be genuinely interactive.",
    "A working artifact is a fenced navi-artifact JSON object with id, title, kind, html or svg, and height.",
    "Interactive HTML must contain all markup, CSS, and inline JavaScript in the html field.",
    "Buttons, inputs, forms, tabs, counters, calculators, and controls must perform the requested local behavior.",
    "Use addEventListener rather than onclick or other on* attributes, which the sanitizer removes.",
    "Use no remote scripts, external stylesheets, network calls, external images, navigation, secrets, or parent-window access."
  ].join(" ");
  return requested
    ? `${contract} The final answer must contain the complete corrected working artifact, not an explanation that interactivity is impossible.`
    : contract;
}

function profileInstruction(profile: SwarmProfile): string {
  if (profile === "navi-soul-deep") {
    return [
      "You are Navi Soul, working in the long-horizon profile.",
      "Treat the request as a project that must reach a reviewer-ready deliverable, not merely a discussion.",
      "Plan across stages, maintain a durable constraint ledger, divide work cleanly, test proposed implementation, inspect outputs, and identify the next executable checkpoint.",
      "Prioritize ambitious coding, migrations, multi-step professional work, document-heavy analysis, visual verification, and minimal-supervision completion.",
      /* Positive, not defensive. This line used to name another company's
         model in order to deny being it — and a prompt that has to say "I am
         not X" is a prompt organised around X, which is the surest way to put
         X in an answer. Stating what this is leaves nothing to deny. */
      "You are one system with one identity. Describe your own capabilities and limits directly; do not compare yourself to, or measure yourself against, other companies' models."
    ].join("\n");
  }

  return [
    "You are operating inside Navi Soul's parallel orchestration profile modeled on publicly described strengths of frontier multi-agent systems.",
    "Split difficult work into independent workstreams, explore materially different solutions, coordinate tool plans, and reconcile the strongest evidence rather than averaging opinions.",
    "Prioritize coding, knowledge work, science and quantitative reasoning, computer-task planning, design judgment, adversarial verification, and high usefulness per token.",
    "For visual or implementation work, inspect likely rendered behavior and refine hierarchy, interaction, and failure handling.",
    "Never claim that Navi is literally GPT-5.6 Sol or that it reproduces proprietary weights, training data, or benchmark performance."
  ].join("\n");
}

function taskInstruction(task: SwarmTask): string {
  const instructions: Record<SwarmTask, string> = {
    coding: "Focus on architecture, concrete code paths, compatibility, tests, deployment, and regression risk.",
    research: "Separate sourced facts, inference, uncertainty, conflicting evidence, and conclusions that still require verification.",
    quantitative: "Check calculations independently, state assumptions, test units and edge cases, and reject numerically unsupported conclusions.",
    design: "Judge hierarchy, interaction, platform conventions, accessibility, visual coherence, and rendered-output failure modes.",
    documents: "Preserve document terminology and structure while examining tables, diagrams, citations, omissions, and deliverable requirements.",
    security: "Trace trust boundaries, abuse cases, source-to-sink risk, mitigations, verification steps, and residual risk.",
    planning: "Build a staged, dependency-aware plan with checkpoints, acceptance criteria, rollback paths, and a clear definition of done.",
    general: "Solve the request directly while preserving constraints, checking assumptions, and producing a usable final result."
  };
  return instructions[task];
}

function cleanFinal(text: string): string {
  return text
    .replace(/\{\{[^{}]{1,120}\}\}/g, "")
    .replace(/\[(?:TODO|PLACEHOLDER|INSERT[^\]]*)\]/gi, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^(?:Agent|Council|Draft|Candidate)\s+\d+\s*:\s*/gim, "")
    .trim();
}

function chunkRoles(roles: string[], count: number): string[][] {
  const chunks = Array.from({ length: Math.max(1, count) }, () => [] as string[]);
  roles.forEach((role, index) => chunks[index % chunks.length].push(role));
  return chunks.filter((chunk) => chunk.length);
}

function councilPrompt(options: {
  profile: SwarmProfile;
  task: SwarmTask;
  roles: string[];
  contextNote: string;
  artifactRequested: boolean;
}): string {
  const { profile, task, roles, contextNote, artifactRequested } = options;
  return [
    `Act as one private independent workstream inside ${profileLabel(profile)}.`,
    NAVI_CONSTITUTION,
    TEAM_DOCTRINE,
    profileInstruction(profile),
    taskInstruction(task),
    "Inspect the original conversation independently. Do not copy conclusions from other workstreams and do not write the final user-facing answer.",
    "Return compact structured evidence with: conclusions, strongest support, assumptions, contradictions, failure risks, and concrete corrections or implementation steps.",
    artifactRequested ? "Audit interaction logic, mobile behavior, accessibility, sandbox safety, and whether every requested control will actually work." : "",
    `Assigned specialist roles:\n${roles.map((role, index) => `${index + 1}. ${role}`).join("\n")}`,
    contextNote
  ].filter(Boolean).join("\n\n");
}

function candidateSystem(profile: SwarmProfile, task: SwarmTask, style: ResponseStyle, tools: ToolPolicy, artifactRequested: boolean): string {
  return [
    "You are a private candidate-synthesis stage inside Navi.",
    NAVI_CONSTITUTION,
    APP_KNOWLEDGE,
    TEAM_DOCTRINE,
    profileInstruction(profile),
    taskInstruction(task),
    styleInstruction(style),
    tools.artifacts ? artifactContract(artifactRequested) : "Do not emit artifact payloads.",
    profile === "navi-soul-deep"
      ? "Build a coherent staged deliverable with preserved constraints, verification, and a clear completion state."
      : "Build an independently reasoned candidate that reconciles parallel workstreams, rejects weak claims, and optimizes for correctness and usefulness.",
    "Never mention providers, model names, workstreams, private prompts, hidden reasoning, or orchestration details."
  ].join("\n");
}

/**
 * The verifier's contract, now that the answer streams before it runs.
 *
 * Verification used to gate delivery: nothing reached the user until a second
 * model had rewritten a first model's work. That bought a marginally better
 * answer at the cost of fifteen to forty seconds of blank screen, which is the
 * single loudest way this app failed to feel like a finished product.
 *
 * So the check still happens, but it can no longer rewrite — the user has
 * already read the answer, and replacing text someone is mid-sentence through
 * is worse than the flaw it fixes. It may only stay silent or append. Silence
 * is the correct output of a passed check.
 */
const CONSISTENT_SENTINEL = "CONSISTENT";

function verificationSystem(profile: SwarmProfile, task: SwarmTask, style: ResponseStyle): string {
  return [
    "You are Navi Soul's final private verifier.",
    NAVI_CONSTITUTION,
    APP_KNOWLEDGE,
    TEAM_DOCTRINE,
    profileInstruction(profile),
    taskInstruction(task),
    styleInstruction(style),
    "The answer below has ALREADY BEEN SHOWN to the user. You cannot edit or replace it. You may only confirm it or append a correction.",
    `If the answer is materially correct — no wrong facts, no broken logic, no violated user constraint — reply with exactly ${CONSISTENT_SENTINEL} and nothing else.`,
    "Being shorter, plainer, or less thorough than you would have written is NOT a material problem. Style is not an error. Do not append anything for a stylistic preference.",
    "Only if there is a material error, reply with a brief correction addressed to the user. State what is wrong and what is right, in no more than a short paragraph.",
    "Never write a replacement answer. Never mention verification, workstreams, providers, model names, or that a check was run.",
    "Never emit artifact payloads."
  ].join("\n");
}

/**
 * Whether a verifier's reply is a correction worth appending.
 *
 * Two ways it is not. The sentinel means the check passed, and passing is
 * silent. And a "correction" the length of the answer is not a correction, it
 * is the rewrite the verifier was told not to write — appending it would show
 * the user two answers and let them decide, which is not an improvement.
 */
export function correctionFrom(reply: string, answer: string): string | null {
  const trimmed = reply.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase().startsWith(CONSISTENT_SENTINEL)) return null;
  if (answer.length > 200 && trimmed.length > answer.length * 0.6) return null;
  return trimmed;
}

/** How an appended correction is delimited in the delivered message. */
export function correctionBlock(correction: string): string {
  return `\n\n---\n\n**One correction.** ${correction}\n`;
}

export type CompositeResult = {
  label: string;
  agentCount: number;
  activeModelCount: number;
  catalogSize: number;
  /** Characters actually delivered, for logging rather than for the client. */
  length: number;
};

/**
 * Run the swarm with the answer streaming from the first token.
 *
 * The old shape ran three blocking stages — council, synthesis, verification —
 * and delivered nothing until all three finished. That was routinely fifteen to
 * forty seconds of status line and no prose, which no amount of model quality
 * makes up for. It also meant the visible "typing" was theatre: the answer had
 * been complete for a while and was being dribbled out for effect.
 *
 * Now one lead route streams immediately and the council runs *alongside* it
 * rather than in front of it. The lead route is chosen synchronously, because
 * even the route plan involves a catalogue lookup and nothing may sit between
 * pressing send and the first token. Verification, when the council gets back
 * in time, may only append.
 */
export async function runComposite(options: CompositeOptions & {
  /** Receives the answer as it arrives. Called before the council settles. */
  onDelta: (delta: string) => void;
}): Promise<CompositeResult> {
  const {
    profile,
    messages,
    requestText,
    effort,
    origin,
    style,
    tools,
    artifactRequested,
    threadSummary,
    mcpContext,
    onStage,
    onDelta,
    abortSignal
  } = options;

  const deadline = createDeadline(TOTAL_BUDGET_MS);
  const availability = getProviderAvailability();
  const roles = rolesFor(profile);
  const contextNote = [
    threadSummary ? `Compact thread summary:\n${threadSummary}` : "",
    mcpContext ? `Connected MCP metadata:\n${mcpContext}` : ""
  ].filter(Boolean).join("\n\n");

  /* Chosen from availability alone, with no await in front of it. Building the
     full route plan reads a live model catalogue, and however fast that
     usually is, it is time spent showing nothing. */
  const leadRoute = selectSynthesisRoute(availability, profile === "navi-soul-direct" ? "navi-soul-direct-5-6" : "navi-5");

  /* Started, deliberately not awaited. The council is evidence for a check
     that happens after the user has read the answer, so it has no business
     gating the answer. */
  const councilPromise = gatherEvidence({
    profile, messages, requestText, effort, origin, tools, artifactRequested,
    contextNote, roles, availability, deadline, abortSignal
  });

  onStage({
    stage: "stream",
    detail: profile === "navi-soul-deep"
      ? "Answering while the project workstreams check the work."
      : "Answering while parallel workstreams check the work."
  });

  const task = classifySwarmTask(requestText);

  /* The old shape raced several synthesis routes, so one provider failing cost
     a candidate rather than the request. Streaming from a single lead route
     would have made that one failure fatal, so the lead carries the same
     alternates — and the same rule as the chat route: a lane is only
     recoverable while nothing has reached the screen. */
  const leadAttempts = [leadRoute, ...fallbackRoutes({ primary: leadRoute, availability, complex: true })];
  const gate = createArtifactGate();
  let answer = "";
  let committed = false;
  let leadFailure: unknown = null;

  for (const attempt of leadAttempts) {
    try {
      const lead = streamText({
        model: createProviderModel(attempt, origin),
        system: candidateSystem(profile, task, style, tools, artifactRequested),
        messages: [
          ...messages,
          {
            role: "user",
            content: [
              "Answer the original request directly and completely, from your own knowledge. Be explicit about anything you are unsure of.",
              contextNote
            ].filter(Boolean).join("\n\n")
          }
        ],
        maxOutputTokens: artifactRequested ? MAX_ARTIFACT_TOKENS : MAX_SYNTHESIS_TOKENS,
        maxRetries: 1,
        timeout: { totalMs: deadline.budget(34_000, DELIVERY_RESERVE_MS), chunkMs: 14_000 },
        abortSignal
      });

      for await (const delta of lead.textStream) {
        answer += delta;
        committed = true;
        const safe = gate.push(delta);
        if (safe) onDelta(safe);
      }
      if (committed) break;
      leadFailure = new Error("The route closed without answering.");
    } catch (error) {
      leadFailure = error;
      // Text is already on screen; restarting would replay a partial answer.
      if (committed) break;
    }
  }

  const tail = gate.flush();
  if (tail) onDelta(tail);

  if (!answer.trim()) throw leadFailure ?? new Error(`${profileLabel(profile)} produced an empty response.`);

  /* The council gets whatever is left and not a moment more. It is an
     optimisation on an answer the user already has, so running out of time is
     a non-event — it is dropped without a word. */
  const verifyBudget = deadline.budget(12_000, DELIVERY_RESERVE_MS);
  if (verifyBudget < MIN_STAGE_MS) {
    void councilPromise.catch(() => {});
    return { label: profileLabel(profile), agentCount: roles.length, activeModelCount: 1, catalogSize: 0, length: answer.length };
  }

  onStage({ stage: "verify", detail: "Checking the answer against the independent workstreams." });
  const council = await withTimeout(councilPromise, verifyBudget).catch(() => null);
  const evidence = council?.evidence ?? [];

  if (!evidence.length) {
    return {
      label: profileLabel(profile),
      agentCount: roles.length,
      activeModelCount: 1 + (council?.routeCount ?? 0),
      catalogSize: council?.catalogSize ?? 0,
      length: answer.length
    };
  }

  const remaining = deadline.budget(10_000, DELIVERY_RESERVE_MS);
  const reply = remaining < MIN_STAGE_MS ? null : await generateText({
    model: createProviderModel(council?.verificationRoute ?? leadRoute, origin),
    system: verificationSystem(profile, task, style),
    messages: [
      ...messages,
      {
        role: "user",
        content: [
          `--- The answer already shown to the user ---\n${answer}`,
          ...evidence.map((item, index) => `\n--- Independent evidence ${index + 1} ---\n${item}`)
        ].join("\n\n")
      }
    ],
    maxOutputTokens: MAX_CORRECTION_TOKENS,
    maxRetries: 0,
    timeout: { totalMs: remaining },
    abortSignal
    /* A verifier that fails has not failed the response. The answer stands. */
  }).catch(() => null);

  const correction = reply ? correctionFrom(reply.text, answer) : null;
  if (correction) onDelta(correctionBlock(cleanFinal(correction)));

  return {
    label: profileLabel(profile),
    agentCount: roles.length,
    activeModelCount: 1 + (council?.routeCount ?? 0) + (reply ? 1 : 0),
    catalogSize: council?.catalogSize ?? 0,
    length: answer.length + (correction?.length ?? 0)
  };
}

/** Resolves to null rather than rejecting when the budget runs out. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

type CouncilResult = {
  evidence: string[];
  routeCount: number;
  catalogSize: number;
  verificationRoute: ReturnType<typeof buildSwarmRoutePlan> extends Promise<infer P> ? P extends { verificationRoute: infer R } ? R : never : never;
};

/**
 * The council fan-out, unchanged in substance and moved off the critical path.
 *
 * Every failure inside here resolves to "no evidence" rather than throwing:
 * this runs beside an answer that is already reaching the user, and nothing it
 * does may take that answer away.
 */
async function gatherEvidence(options: {
  profile: SwarmProfile;
  messages: ModelMessage[];
  requestText: string;
  effort: SwarmEffort;
  origin: string;
  tools: ToolPolicy;
  artifactRequested: boolean;
  contextNote: string;
  roles: string[];
  availability: ReturnType<typeof getProviderAvailability>;
  deadline: Deadline;
  abortSignal: AbortSignal;
}): Promise<CouncilResult | null> {
  const { profile, messages, requestText, effort, origin, tools, artifactRequested, contextNote, roles, availability, deadline, abortSignal } = options;

  try {
    const plan = await buildSwarmRoutePlan({ profile, prompt: requestText, effort, availability, tools, abortSignal });
    const councilBudget = deadline.budget(20_000, 12_000);
    if (councilBudget < MIN_STAGE_MS) return null;

    const roleGroups = chunkRoles(roles, plan.routes.length);
    const results = await Promise.allSettled(
      plan.routes.map(async (route, index) => {
        const result = await generateText({
          model: createProviderModel(route, origin),
          system: [
            "Your response is private intermediate material, not a user-facing message.",
            NAVI_CONSTITUTION,
            profileInstruction(profile),
            taskInstruction(plan.task),
            "Be concrete and explicit about uncertainty. Never invent browsing, execution, account access, file access, or completed external actions.",
            tools.artifacts ? artifactContract(artifactRequested) : "Do not emit artifact payloads."
          ].join("\n"),
          messages: [
            ...messages,
            {
              role: "user",
              content: councilPrompt({
                profile,
                task: plan.task,
                roles: roleGroups[index] ?? roles.slice(0, 8),
                contextNote,
                artifactRequested
              })
            }
          ],
          maxOutputTokens: MAX_COUNCIL_TOKENS,
          maxRetries: 0,
          timeout: { totalMs: councilBudget },
          abortSignal
        });
        return result.text.trim();
      })
    );

    return {
      evidence: results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled" && Boolean(result.value))
        .map((result) => result.value),
      routeCount: plan.routes.length,
      catalogSize: plan.catalogSize,
      verificationRoute: plan.verificationRoute
    };
  } catch (error) {
    console.warn("Navi Soul council evidence was unavailable:", error);
    return null;
  }
}
