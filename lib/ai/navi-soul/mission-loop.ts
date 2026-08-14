/* PATH: lib/ai/navi-soul/mission-loop.ts  — NEW FILE, copy verbatim. */

/**
 * The autonomous task loop: Navi Soul breaks a big request into steps, runs
 * each step through the cheapest thing that can do it exactly — an on-device
 * skill before an engine, every engine call already routed and preflighted by
 * the caller — checks its own result, and revises once if the check fails.
 *
 * Everything external is injected. `runEngine` is whatever the chat route
 * already does for one model call (planTurn + preflightPayload + stream), so
 * the loop adds no second routing system and no new spending path; `runSkill`
 * is the zero-token layer, injected because on the client it is the full
 * `instantAnswer` library and on the edge it is the safe local subset. A loop
 * that owns no I/O can be tested with a script of canned replies, which the
 * test suite does.
 *
 * Budgets are hard. `maxEngineCalls` bounds the whole mission — decomposition,
 * steps, verification, revision — because an autonomous loop without a meter
 * is how a free-tier app spends a day's quota on one message. Running out is
 * reported as what it is, never dressed up as completion.
 */

export type MissionStep = {
  index: number;
  title: string;
  instruction: string;
  /** "skill" = has one exact answer a tool may know; tried on-device first. */
  kind: "skill" | "engine";
};

export type StepResult = {
  step: MissionStep;
  output: string;
  source: "skill" | "engine" | "failed";
  /** The skill that answered, when one did. */
  skill?: string;
};

export type MissionReport = {
  status: "complete" | "budget-exhausted" | "failed";
  steps: StepResult[];
  answer: string;
  engineCalls: number;
  skillHits: number;
  /** null when verification was off or unaffordable. */
  verified: boolean | null;
  notes: string[];
};

export type MissionExecutors = {
  /** One routed, preflighted model call. The caller owns routing and spend. */
  runEngine: (prompt: string, purpose: "decompose" | "step" | "verify" | "revise") => Promise<string>;
  /** The zero-token layer; null means "no exact answer, use an engine". */
  runSkill?: (query: string) => Promise<{ text: string; skill: string } | null>;
  /** Feeds the activity chips. */
  onProgress?: (label: string) => void;
};

export type MissionOptions = {
  /** Steps after sanitisation; the synthesis step is added on top. */
  maxSteps?: number;
  /** Every engine call the mission may make, of any purpose. */
  maxEngineCalls?: number;
  verify?: boolean;
};

const DEFAULTS = { maxSteps: 6, maxEngineCalls: 8, verify: true } as const;

/** How much prior-step context a step prompt may carry. Newest survives. */
const CONTEXT_CHARS = 4_000;

/**
 * Is this request actually a mission?
 *
 * Anchored like every classifier here: multi-part language, or an explicit
 * plan-and-do instruction. A single question run through the loop costs three
 * calls to produce what one would have — the false positive is the expensive
 * mistake, so ambiguity stays a normal turn.
 */
const MULTI_STEP = /\b(step by step|one by one|first\b[\s\S]{0,120}?\bthen\b|and then\b[\s\S]{0,120}?\b(?:and|then)\b|plan (?:and|then) (?:do|execute|build|write)|break (?:this|it) down|checklist|itinerary|research\b[\s\S]{0,80}?\b(?:then|and) (?:write|draft|summari[sz]e|build))\b/i;
const NUMBERED_LIST = /(?:^|\n)\s*1[.)]\s+\S[\s\S]*?(?:^|\n)\s*2[.)]\s+\S/m;

export function shouldRunAsMission(request: string, effort: "low" | "medium" | "high"): boolean {
  if (request.length < 60) return false;
  if (MULTI_STEP.test(request) || NUMBERED_LIST.test(request)) return true;
  /* High effort plus a long brief is the shape of "do this whole thing". */
  return effort === "high" && request.length > 400;
}

function decompositionPrompt(request: string, maxSteps: number): string {
  return [
    "Split the request below into the fewest sequential steps that complete it — never more than",
    `${maxSteps}. Reply with ONLY a JSON array, no prose:`,
    `[{"title": "three words", "instruction": "one imperative sentence", "kind": "skill" | "engine"}]`,
    `"kind" is "skill" only when the step has exactly one right answer a deterministic tool could`,
    "produce (arithmetic, conversion, date math, counting, encoding, extraction); otherwise \"engine\".",
    "",
    `REQUEST:\n${request}`
  ].join("\n");
}

/** Tolerant of fences and prose around the array; strict about what is kept. */
export function parseSteps(reply: string, maxSteps: number): MissionStep[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const steps: MissionStep[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.instruction !== "string" || !record.instruction.trim()) continue;
      steps.push({
        index: steps.length,
        title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 60) : `Step ${steps.length + 1}`,
        instruction: record.instruction.trim().slice(0, 500),
        kind: record.kind === "skill" ? "skill" : "engine"
      });
      if (steps.length >= maxSteps) break;
    }
    return steps;
  } catch {
    return [];
  }
}

function contextFrom(results: StepResult[]): string {
  const lines = results.map((result) => `${result.step.title}: ${result.output}`);
  let context = lines.join("\n\n");
  if (context.length > CONTEXT_CHARS) context = context.slice(context.length - CONTEXT_CHARS);
  return context;
}

function stepPrompt(request: string, step: MissionStep, prior: StepResult[]): string {
  const context = contextFrom(prior);
  return [
    `You are executing one step of a larger task. Do only this step, completely, and reply with its result only.`,
    `OVERALL TASK:\n${request}`,
    context ? `RESULTS SO FAR:\n${context}` : "",
    `THIS STEP:\n${step.instruction}`
  ].filter(Boolean).join("\n\n");
}

export async function runMission(
  request: string,
  executors: MissionExecutors,
  options: MissionOptions = {}
): Promise<MissionReport> {
  const { maxSteps, maxEngineCalls, verify } = { ...DEFAULTS, ...options };
  const progress = executors.onProgress ?? (() => {});
  const notes: string[] = [];
  const results: StepResult[] = [];
  let engineCalls = 0;
  let skillHits = 0;

  const engine = async (prompt: string, purpose: Parameters<MissionExecutors["runEngine"]>[1]): Promise<string | null> => {
    if (engineCalls >= maxEngineCalls) return null;
    engineCalls += 1;
    return executors.runEngine(prompt, purpose);
  };

  /* 1 — decompose. A refusal or garbage decomposition degrades to running the
     request as its own single step, which is exactly what a normal turn is. */
  progress("Planning the steps");
  let steps: MissionStep[] = [];
  try {
    const reply = await engine(decompositionPrompt(request, maxSteps), "decompose");
    if (reply !== null) steps = parseSteps(reply, maxSteps);
  } catch (error) {
    notes.push(`Decomposition failed (${error instanceof Error ? error.message : "error"}); ran as a single step.`);
  }
  if (!steps.length) steps = [{ index: 0, title: "Answer", instruction: request, kind: "engine" }];

  /* The mission always ends by combining its own work: without this, the user
     gets step six as the answer and steps one to five as trivia. */
  if (steps.length > 1) {
    steps.push({
      index: steps.length,
      title: "Combine",
      instruction: "Combine the results so far into one complete answer to the overall task, in one voice, resolving any disagreement between steps.",
      kind: "engine"
    });
  }

  /* 2 — execute, cheapest-capable first. */
  for (const step of steps) {
    progress(step.title);

    if (step.kind === "skill" && executors.runSkill) {
      try {
        const hit = await executors.runSkill(step.instruction);
        if (hit) {
          skillHits += 1;
          results.push({ step, output: hit.text, source: "skill", skill: hit.skill });
          continue;
        }
      } catch {
        /* A skill that throws costs nothing; the engine does the step. */
      }
    }

    let output: string | null = null;
    try {
      output = await engine(stepPrompt(request, step, results), "step");
    } catch (error) {
      notes.push(`"${step.title}" failed: ${error instanceof Error ? error.message : "error"}.`);
      results.push({ step, output: "[This step failed; the answer proceeds without it.]", source: "failed" });
      continue;
    }
    if (output === null) {
      notes.push(`Stopped at "${step.title}": the mission's engine budget (${maxEngineCalls} calls) was spent.`);
      return {
        status: "budget-exhausted",
        steps: results,
        answer: contextFrom(results) || "The task could not be completed within its budget.",
        engineCalls, skillHits, verified: null, notes
      };
    }
    results.push({ step, output, source: "engine" });
  }

  const finalStep = results[results.length - 1];
  if (!finalStep || finalStep.source === "failed") {
    return { status: "failed", steps: results, answer: contextFrom(results), engineCalls, skillHits, verified: null, notes };
  }
  let answer = finalStep.output;

  /* 3 — verify, then one revision. Skipped without comment when the budget
     cannot afford it: an unverified answer beats no answer, and the report
     says which one was delivered. */
  let verified: boolean | null = null;
  if (verify && engineCalls < maxEngineCalls) {
    progress("Checking the result");
    try {
      const check = await engine(
        `Does the ANSWER completely and correctly satisfy the REQUEST? Reply "PASS", or one line naming the single most important defect.\n\nREQUEST:\n${request}\n\nANSWER:\n${answer.slice(0, 6_000)}`,
        "verify"
      );
      if (check !== null) {
        verified = /^\s*PASS\b/i.test(check);
        if (!verified && engineCalls < maxEngineCalls) {
          progress("Revising");
          const revised = await engine(
            `Revise the ANSWER to fix this defect, changing nothing else. Reply with the full revised answer only.\n\nDEFECT: ${check.trim().slice(0, 300)}\n\nREQUEST:\n${request}\n\nANSWER:\n${answer.slice(0, 6_000)}`,
            "revise"
          );
          if (revised !== null && revised.trim()) {
            answer = revised;
            verified = true;
            notes.push("The first draft failed its own check and was revised once.");
          }
        }
      }
    } catch {
      verified = null; // A broken checker must not break a finished answer.
    }
  }

  return { status: "complete", steps: results, answer, engineCalls, skillHits, verified, notes };
}
