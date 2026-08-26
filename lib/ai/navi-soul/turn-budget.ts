export type TurnBudgetClass = "trivial" | "standard" | "research" | "artifact" | "code" | "deep";
export type TurnDispatch = "general" | "research" | "reasoning" | "code";
export type TurnEffort = "low" | "medium" | "high";
export type TurnStyle = "balanced" | "concise" | "detailed";

export type TurnBudgetInput = {
  request: string;
  dispatch: TurnDispatch;
  effort: TurnEffort;
  style: TurnStyle;
  artifactRequested: boolean;
  hasFiles: boolean;
  planSteps?: number;
};

export type TurnBudget = {
  class: TurnBudgetClass;
  /** Hard ceiling for one assistant answer on this turn. */
  maxOutputTokens: number;
  /** Smallest useful reply worth reserving while fitting a provider payload. */
  minOutputTokens: number;
  /** Maximum tool round trips before the answer must finish. Tool visibility belongs to the relevance-aware registry. */
  maxToolSteps: number;
  /** Maximum model calls inside a mission/decomposition loop. */
  maxEngineCalls: number;
  /** Output ceilings for mechanical subcalls that should never inherit the answer budget. */
  subcallTokens: {
    decompose: number;
    step: number;
    verify: number;
    revise: number;
    fast: number;
  };
};

const TRIVIAL_REQUEST = /^(?:hi|hello|hey|yo|thanks|thank you|thx|ok|okay|k|cool|nice|great|got it|sounds good|yes|yep|yeah|no|nope|bye|goodbye|good morning|good afternoon|good evening)[!.?\s]*$/iu;

const BASE: Record<TurnBudgetClass, TurnBudget> = {
  trivial: {
    class: "trivial",
    maxOutputTokens: 512,
    minOutputTokens: 192,
    maxToolSteps: 1,
    maxEngineCalls: 1,
    subcallTokens: { decompose: 384, step: 512, verify: 384, revise: 512, fast: 384 }
  },
  standard: {
    class: "standard",
    maxOutputTokens: 1_800,
    minOutputTokens: 512,
    maxToolSteps: 4,
    maxEngineCalls: 3,
    subcallTokens: { decompose: 600, step: 1_200, verify: 600, revise: 1_400, fast: 600 }
  },
  research: {
    class: "research",
    maxOutputTokens: 3_600,
    minOutputTokens: 900,
    maxToolSteps: 8,
    maxEngineCalls: 6,
    subcallTokens: { decompose: 750, step: 2_000, verify: 800, revise: 2_400, fast: 700 }
  },
  artifact: {
    class: "artifact",
    maxOutputTokens: 4_800,
    minOutputTokens: 1_400,
    maxToolSteps: 8,
    maxEngineCalls: 6,
    subcallTokens: { decompose: 700, step: 2_600, verify: 800, revise: 2_800, fast: 650 }
  },
  code: {
    class: "code",
    maxOutputTokens: 6_000,
    minOutputTokens: 1_200,
    maxToolSteps: 14,
    maxEngineCalls: 10,
    subcallTokens: { decompose: 800, step: 3_000, verify: 900, revise: 3_200, fast: 700 }
  },
  deep: {
    class: "deep",
    maxOutputTokens: 6_400,
    minOutputTokens: 1_200,
    maxToolSteps: 12,
    maxEngineCalls: 10,
    subcallTokens: { decompose: 850, step: 3_000, verify: 900, revise: 3_200, fast: 700 }
  }
};

function classifyTurn(input: TurnBudgetInput): TurnBudgetClass {
  const request = input.request.trim();
  if (
    input.dispatch === "general"
    && !input.artifactRequested
    && !input.hasFiles
    && request.length <= 80
    && TRIVIAL_REQUEST.test(request)
  ) {
    return "trivial";
  }
  if (input.dispatch === "code") return "code";
  if (input.artifactRequested) return "artifact";
  if (input.dispatch === "research") return "research";
  if (input.dispatch === "reasoning" || input.effort === "high" || (input.planSteps ?? 0) >= 4) return "deep";
  return "standard";
}

function withPresentationAdjustments(budget: TurnBudget, input: TurnBudgetInput): TurnBudget {
  if (budget.class === "trivial") return budget;

  let maxOutputTokens = budget.maxOutputTokens;
  if (input.style === "concise") maxOutputTokens = Math.max(budget.minOutputTokens, Math.floor(maxOutputTokens * 0.72));
  if (input.style === "detailed") maxOutputTokens = Math.min(7_000, Math.floor(maxOutputTokens * 1.18));
  if (input.effort === "low") maxOutputTokens = Math.max(budget.minOutputTokens, Math.floor(maxOutputTokens * 0.82));

  return { ...budget, maxOutputTokens };
}

/**
 * Compile one user turn into deterministic resource limits before any provider
 * request is assembled. A simple greeting must not inherit the same 8k output
 * reserve or agent-loop depth as repository surgery.
 *
 * Tool availability is intentionally not part of this object. The tool registry
 * already owns relevance filtering, per-mode ceilings, connector priority, and
 * account-tool preservation. Keeping one owner prevents a second blind cap from
 * silently removing the exact tools a relevant turn needs.
 *
 * This is intentionally not an LLM classifier. Routing may use models elsewhere,
 * but budgeting is a safety/performance boundary and therefore stays cheap,
 * deterministic, inspectable, and testable.
 */
export function compileTurnBudget(input: TurnBudgetInput): TurnBudget {
  const klass = classifyTurn(input);
  return withPresentationAdjustments(BASE[klass], input);
}

export type SubcallPurpose = keyof TurnBudget["subcallTokens"];

/** Mechanical planner/verifier calls never inherit the full answer allowance. */
export function subcallOutputBudget(budget: TurnBudget, purpose: SubcallPurpose, providerRoom: number): number {
  const target = budget.subcallTokens[purpose];
  const room = Math.max(0, Math.floor(providerRoom));
  if (room < 128) return room;
  return Math.min(target, room);
}
