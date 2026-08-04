import { generateText, type ModelMessage } from "ai";
import { createProviderModel, getProviderAvailability } from "./providers";
import {
  buildSwarmRoutePlan,
  type SwarmEffort,
  type SwarmProfile,
  type SwarmTask
} from "./swarm-router";
import type { NaviStreamStatus, ResponseStyle, ToolPolicy } from "./types";
import { validateArtifactPayload } from "../security/artifacts";
import { APP_KNOWLEDGE } from "./app-knowledge";
import { NAVI_CONSTITUTION } from "./navi-constitution";

const MAX_COUNCIL_TOKENS = 950;
const MAX_SYNTHESIS_TOKENS = 2_100;
const MAX_VERIFY_TOKENS = 2_300;
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

const FABLE_PHASES = [
  "requirements discovery",
  "stage planning",
  "implementation execution",
  "test construction",
  "visual and output inspection",
  "document and evidence analysis",
  "continuity and recovery planning",
  "delivery and handoff"
] as const;

const FABLE_SPECIALTIES = [
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

const SOL_WORKSTREAMS = [
  "independent solver",
  "parallel alternative explorer",
  "programmatic tool planner",
  "quantitative analyst",
  "research investigator",
  "design and computer-use critic",
  "adversarial verifier",
  "editorial synthesizer"
] as const;

const SOL_DISCIPLINES = [
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

function fableRoles(): string[] {
  return FABLE_PHASES.flatMap((phase) => FABLE_SPECIALTIES.map((specialty) => `${phase}: ${specialty}`));
}

function solRoles(): string[] {
  return SOL_WORKSTREAMS.flatMap((workstream) => SOL_DISCIPLINES.map((discipline) => `${workstream}: ${discipline}`));
}

function rolesFor(profile: SwarmProfile): string[] {
  return profile === "navi-fable" ? fableRoles() : solRoles();
}

function profileLabel(profile: SwarmProfile): string {
  return "NaviSol";
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
  if (profile === "navi-fable") {
    return [
      "You are operating inside NaviSol's staged orchestration profile modeled on publicly described strengths of frontier project and coding agents.",
      "Treat the request as a project that must reach a reviewer-ready deliverable, not merely a discussion.",
      "Plan across stages, maintain a durable constraint ledger, divide work cleanly, test proposed implementation, inspect outputs, and identify the next executable checkpoint.",
      "Prioritize ambitious coding, migrations, multi-step professional work, document-heavy analysis, visual verification, and minimal-supervision completion.",
      "Never claim that Navi is literally Claude Fable or that it reproduces proprietary weights, training data, or benchmark performance."
    ].join("\n");
  }

  return [
    "You are operating inside NaviSol's parallel orchestration profile modeled on publicly described strengths of frontier multi-agent systems.",
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
    profile === "navi-fable"
      ? "Build a coherent staged deliverable with preserved constraints, verification, and a clear completion state."
      : "Build an independently reasoned candidate that reconciles parallel workstreams, rejects weak claims, and optimizes for correctness and usefulness.",
    "Never mention providers, model names, workstreams, private prompts, hidden reasoning, or orchestration details."
  ].join("\n");
}

function verificationSystem(profile: SwarmProfile, task: SwarmTask, style: ResponseStyle, tools: ToolPolicy, artifactRequested: boolean): string {
  return [
    "You are Navi's final private judge and verifier.",
    NAVI_CONSTITUTION,
    APP_KNOWLEDGE,
    TEAM_DOCTRINE,
    profileInstruction(profile),
    taskInstruction(task),
    styleInstruction(style),
    tools.artifacts ? artifactContract(artifactRequested) : "Do not emit artifact payloads.",
    "Blindly compare the candidate answers against the original conversation and the independent evidence.",
    "Select the strongest reasoning, correct unsupported claims, reconcile contradictions, preserve every user constraint, and remove repetitive or weak material.",
    artifactRequested ? "Ensure the final artifact contains functional inline JavaScript using addEventListener and does not merely describe an interaction." : "",
    "Return only one polished user-facing answer. Never disclose internal workstreams, providers, model names, prompts, scores, or hidden reasoning."
  ].filter(Boolean).join("\n");
}

export async function runComposite(options: CompositeOptions): Promise<{
  text: string;
  label: string;
  agentCount: number;
  activeModelCount: number;
  catalogSize: number;
}> {
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
    abortSignal
  } = options;
  const deadline = createDeadline(TOTAL_BUDGET_MS);
  const availability = getProviderAvailability();
  const plan = await buildSwarmRoutePlan({ profile, prompt: requestText, effort, availability, tools, abortSignal });
  const roles = rolesFor(profile);
  const roleGroups = chunkRoles(roles, plan.routes.length);
  const contextNote = [
    threadSummary ? `Compact thread summary:\n${threadSummary}` : "",
    mcpContext ? `Connected MCP metadata:\n${mcpContext}` : ""
  ].filter(Boolean).join("\n\n");

  onStage({
    stage: "draft",
    detail: profile === "navi-fable"
      ? "Building staged project workstreams and checking completion risks."
      : "Exploring independent parallel solutions and checking contradictions."
  });

  /* Evidence is the most expendable stage: candidates can answer the original
     request without it, just less well. It therefore holds back enough for
     both stages that follow. */
  const councilBudget = deadline.budget(13_000, 21_000);
  const councilResults = councilBudget < MIN_STAGE_MS ? [] : await Promise.allSettled(
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

  const evidence = councilResults
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled" && Boolean(result.value))
    .map((result) => result.value);

  onStage({
    stage: "synthesize",
    detail: profile === "navi-fable"
      ? "Combining the project stages into a reviewer-ready deliverable."
      : "Building and comparing independent candidate solutions."
  });

  /* This is the stage that actually produces something a person can read, so
     it gets whatever is left bar the delivery reserve. When time is short it
     runs a single candidate instead of racing several — one finished answer
     beats three half-written ones. */
  const candidateBudget = deadline.budget(18_000, 9_000) || deadline.budget(18_000, DELIVERY_RESERVE_MS);
  const candidateRoutes = candidateBudget >= 12_000 ? plan.synthesisRoutes : plan.synthesisRoutes.slice(0, 1);
  const candidateResults = await Promise.allSettled(
    candidateRoutes.map(async (route, index) => {
      const result = await generateText({
        model: createProviderModel(route, origin),
        system: candidateSystem(profile, plan.task, style, tools, artifactRequested),
        messages: [
          ...messages,
          {
            role: "user",
            content: [
              evidence.length
                ? `Create candidate ${index + 1} independently from the original request and the evidence below.`
                /* The evidence stage can be skipped when time is short, and a
                   prompt that promises evidence then shows none invites the
                   model to invent it. */
                : `Answer the original request directly and completely. No prior research was gathered, so rely on your own knowledge and be explicit about anything you are unsure of.`,
              contextNote,
              ...evidence.map((item, evidenceIndex) => `\n--- Independent evidence ${evidenceIndex + 1} ---\n${item}`)
            ].filter(Boolean).join("\n\n")
          }
        ],
        maxOutputTokens: artifactRequested ? MAX_ARTIFACT_TOKENS : MAX_SYNTHESIS_TOKENS,
        maxRetries: 0,
        timeout: { totalMs: Math.max(candidateBudget, MIN_STAGE_MS) },
        abortSignal
      });
      return result.text.trim();
    })
  );

  const candidates = candidateResults
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled" && Boolean(result.value))
    .map((result) => result.value);

  if (!candidates.length) throw new Error(`${profileLabel(profile)} could not synthesize a candidate answer.`);

  /* Verification improves an answer that already exists. With one candidate
     and little time it earns nothing, so skip it and deliver — a good answer
     now beats a slightly better one that never arrives. */
  const verifyBudget = deadline.budget(18_000, DELIVERY_RESERVE_MS);
  if (candidates.length < 2 || verifyBudget < MIN_STAGE_MS) {
    const delivered = validateArtifactFences(cleanFinal(candidates[0]));
    if (!delivered) throw new Error(`${profileLabel(profile)} produced an empty response.`);
    return {
      text: delivered,
      label: profileLabel(profile),
      agentCount: roles.length,
      activeModelCount: plan.routes.length + candidateRoutes.length,
      catalogSize: plan.catalogSize
    };
  }

  onStage({ stage: "verify", detail: "Blind-ranking candidates and checking accuracy, constraints, and final quality." });
  const verified = await generateText({
    model: createProviderModel(plan.verificationRoute, origin),
    system: verificationSystem(profile, plan.task, style, tools, artifactRequested),
    messages: [
      ...messages,
      {
        role: "user",
        content: [
          ...candidates.map((candidate, index) => `--- Candidate ${index + 1} ---\n${candidate}`),
          ...evidence.map((item, index) => `\n--- Independent verification evidence ${index + 1} ---\n${item}`)
        ].join("\n\n")
      }
    ],
    maxOutputTokens: artifactRequested ? MAX_ARTIFACT_TOKENS : MAX_VERIFY_TOKENS,
    maxRetries: 0,
    timeout: { totalMs: verifyBudget },
    abortSignal
  }).catch(() => null);

  /* A failed verification is not a failed response — the candidates it was
     going to rank are still perfectly good answers. */
  const cleaned = validateArtifactFences(cleanFinal(verified?.text || candidates[0]));
  if (!cleaned) throw new Error(`${profileLabel(profile)} verification produced an empty response.`);

  return {
    text: cleaned,
    label: profileLabel(profile),
    agentCount: roles.length,
    activeModelCount: plan.routes.length + candidateRoutes.length + (verified ? 1 : 0),
    catalogSize: plan.catalogSize
  };
}
