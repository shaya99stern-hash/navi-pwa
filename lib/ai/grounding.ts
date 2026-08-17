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
/**
 * Whether the critique pass should run at all.
 *
 * Grounding is still required, for the reason at the top of this file: a
 * reviewer with nothing to check against re-reads the draft, agrees with it,
 * and charges a round trip for a reworded version.
 *
 * The lane gate widened from "lane 3 only" to "anything but the fast lane",
 * and the reasoning is worth recording because it was held back twice before.
 * The objection was that spending a second call on turns that currently skip
 * one is a cost/quality trade with no measurement behind it. Two things
 * answered that. The call is free-tier, so the cost is latency and quota rather
 * than money. And the turns this newly covers are research turns — lane 2 with
 * fetched pages — which is precisely where an unchecked answer is most
 * dangerous, because a fabricated citation looks exactly like a real one.
 *
 * Lane 1 stays excluded. It is the lane whose entire promise is speed, and a
 * second round trip is the one thing it cannot afford.
 *
 * Still bounded by the request budget upstream: a critique that cannot finish
 * inside the remaining time is skipped rather than started and killed.
 */
export function critiqueAllowed(options: { lane: number; grounding: Grounding }): boolean {
  return options.lane >= 2 && options.grounding.kind !== "none";
}

/** Why the pass was skipped, for the log. Never shown to a user. */
export function skipReason(options: { lane: number; grounding: Grounding }): string {
  /* Kept in step with `critiqueAllowed` above. When these two disagree the log
     explains a decision that was not the one taken, which is worse than no log
     — it sends whoever is reading it to the wrong place. */
  if (options.lane < 2) return `lane ${options.lane} is the fast lane and cannot afford a second round trip`;
  return "nothing real to check the draft against";
}
