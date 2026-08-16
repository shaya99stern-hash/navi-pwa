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

export type GroundingKind = "execution" | "files" | "sources" | "none";

/** One page actually retrieved this turn, with the address it came from. */
export type FetchedSource = { url: string; text: string };

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
  /** Pages actually retrieved this turn, in the order they were read. */
  sources?: FetchedSource[];
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

  /**
   * Pages read this turn, ranked below files on purpose.
   *
   * A repository file is what this app definitively holds; a fetched page is
   * somebody else's claim, and a well-built page of confident nonsense is still
   * nonsense. So this grounds *attribution* more than it grounds truth, and the
   * instruction says so: the check worth running is whether the draft's claims
   * appear in what was actually retrieved, and whether every cited URL is one
   * that was really read.
   *
   * That second half is the point. Before this, nothing connected the URLs in
   * an answer to the URLs the fetcher returned, so a plausible-looking citation
   * and a real one were indistinguishable to the app — and inventing a citation
   * is the failure mode that makes a research answer worse than no answer,
   * because it looks checked.
   */
  const sources = (options.sources ?? []).filter((source) => source.url && source.text.trim());
  if (sources.length) {
    const material = sources
      .map((source) => `--- Retrieved from ${source.url} ---\n${source.text.trim()}`)
      .join("\n\n");
    return {
      kind: "sources",
      material: clip(material),
      instruction: [
        `The ${sources.length === 1 ? "page" : "pages"} below ${sources.length === 1 ? "was" : "were"} actually fetched this turn, and the addresses shown are where each came from.`,
        "Check the draft against them. A specific claim — a number, a date, a name, a rate — that appears nowhere in this material is unsupported, and either has to be attributed to what is here or dropped.",
        "Check every URL the draft cites against the addresses above. A citation to a page that was not retrieved is the most important error to fix, because it makes an unchecked claim look verified."
      ].join(" ")
    };
  }

  return NONE;
}

/**
 * The addresses actually retrieved, for a caller that wants to compare them to
 * what an answer cited.
 */
export function citedUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>()[\]"'`]+/g) ?? [])]
    .map((url) => url.replace(/[.,;:!?]+$/, ""));
}

/**
 * Whether the critique pass should run at all.
 *
 * Two conditions, both required. The lane must be the one that earns a second
 * call — spending an extra round trip on a fast follow-up is exactly the
 * latency the app has been fighting. And there must be grounding, for the
 * reason above.
 */
/* The lane gate is deliberately unchanged while `sources` is added.
   Adding a grounding kind is additive: turns that had nothing to check against
   can now be checked, and no turn loses a pass it used to get. Widening the
   lane gate is the opposite — it spends a second round trip on turns that
   currently skip one, on every request that qualifies. That is exactly the kind
   of change this repository has no way to evaluate yet, and the eval set has no
   baseline recorded against it. It waits for a number. */
export function critiqueAllowed(options: { lane: number; grounding: Grounding }): boolean {
  return options.lane === 3 && options.grounding.kind !== "none";
}

/** Why the pass was skipped, for the log. Never shown to a user. */
export function skipReason(options: { lane: number; grounding: Grounding }): string {
  if (options.lane !== 3) return `lane ${options.lane} does not earn a critique pass`;
  return "nothing real to check the draft against";
}
