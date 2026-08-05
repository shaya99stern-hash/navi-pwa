/**
 * Whether a self-critique has anything real to check against.
 *
 * A critique pass asked to "review your answer" with nothing to compare it to
 * produces confident noise. The model re-reads its own reasoning, finds it
 * agreeable — it wrote it — and returns a slightly reworded version at the cost
 * of a full extra round trip. That is worse than no pass at all, because it
 * spends the budget *and* adds a step where an error can be introduced.
 *
 * So the pass runs only when there is external material to check against.
 * Until recently there was none; retrieval and code execution now produce
 * exactly that, which is what makes this worth doing at all:
 *
 *  - **Execution output.** The strongest grounding available. The code either
 *    ran or it did not, and stderr is not a matter of opinion.
 *  - **File contents.** The answer claims something about code that is right
 *    here, so the claim is checkable rather than recalled.
 *
 * When neither is present the pass is skipped and the draft is delivered. That
 * is not a degraded path; it is the correct one.
 */

export type GroundingKind = "execution" | "files" | "none";

export type Grounding = {
  kind: GroundingKind;
  /** What the critique is to check the draft against. Empty when kind is none. */
  material: string;
  /** How the critique should be framed, given what it has. */
  instruction: string;
};

const NONE: Grounding = { kind: "none", material: "", instruction: "" };

/** Beyond this the material costs more budget than the check is worth. */
const MAX_MATERIAL_CHARS = 20_000;

function clip(text: string): string {
  return text.length > MAX_MATERIAL_CHARS ? `${text.slice(0, MAX_MATERIAL_CHARS)}\n… truncated.` : text;
}

/**
 * What this turn can check an answer against, in order of how much it proves.
 *
 * Execution beats files because a run is a fact and a file is evidence. If a
 * draft says the function returns 42 and the run says it threw, that is settled
 * without any judgement at all.
 */
export function groundingFor(options: {
  /** Files fetched before generating, when the repository was knowable. */
  retrieved?: string;
  /** Output from code the model actually ran this turn. */
  executionOutput?: string;
}): Grounding {
  const execution = options.executionOutput?.trim();
  if (execution) {
    return {
      kind: "execution",
      material: clip(execution),
      instruction: [
        "The code below was actually run and this is its real output.",
        "Check the draft against it. If the draft claims a behaviour the run contradicts, that is an error and must be corrected.",
        "If the run failed and the draft presents the code as working, that is the most important thing to fix."
      ].join(" ")
    };
  }

  const files = options.retrieved?.trim();
  if (files) {
    return {
      kind: "files",
      material: clip(files),
      instruction: [
        "The file contents below are what the repository actually holds right now.",
        "Check the draft against them. Any claim about code that these files contradict is an error.",
        "Pay particular attention to names, paths, and signatures the draft states as fact."
      ].join(" ")
    };
  }

  return NONE;
}

/**
 * Whether the critique pass should run at all.
 *
 * Two conditions, both required. The lane must be the one that earns a second
 * call — spending an extra round trip on a fast follow-up is exactly the
 * latency the app has been fighting. And there must be grounding, for the
 * reason above.
 */
export function critiqueAllowed(options: { lane: number; grounding: Grounding }): boolean {
  return options.lane === 3 && options.grounding.kind !== "none";
}

/** Why the pass was skipped, for the log. Never shown to a user. */
export function skipReason(options: { lane: number; grounding: Grounding }): string {
  if (options.lane !== 3) return `lane ${options.lane} does not earn a critique pass`;
  return "nothing real to check the draft against";
}
