/**
 * Saying which engine failed, and how, at the moment it fails.
 *
 * ## The finding
 *
 * An external audit of seven days of production errors found 1,961 occurrences
 * across 38 clusters — and **1,093 of them carried no provider, no model and no
 * status code**. `TimeoutError: The operation was aborted due to timeout` and
 * `AI_NoOutputGeneratedError: No output generated`, 56% of everything, arriving
 * as a bare stack frame.
 *
 * Every diagnosable error in the dataset lived in the remaining 44%. The
 * auditor's conclusion is the right one: you cannot fix what you cannot
 * attribute, and this blocks all other triage.
 *
 * The cause is structural rather than careless. The route tries each engine in
 * turn, and a failed attempt is *ordinary* — it is the mechanism working, and
 * the user should never hear about it. So a failure was recorded for the health
 * tracker, kept in `lastFailure`, and the loop moved on. Only the last one was
 * ever thrown, stripped of everything that would identify which of four
 * attempts it came from.
 *
 * The failover is right. What was missing is that a silent failover is silent
 * to *us* as well, and there is no reason for that: the log is not the user.
 *
 * ## What is attached
 *
 * Which engine, which model, which lane, which attempt out of how many, how
 * long it ran, and whatever status the provider actually returned. That last
 * one is the difference between "Cerebras is failing" and "Cerebras is
 * returning 403 with an HTML body", which are the same sentence to a counter
 * and completely different problems to a person.
 */

/** The identifying facts about one attempt, known before it is made. */
export type AttemptFacts = {
  provider: string;
  model: string;
  /** The capability name, e.g. "Navi Deep" — what the user would have seen. */
  engine: string;
  lane: number;
  dispatch: string;
  /** 1-based, so a log line reads "attempt 2 of 4". */
  attempt: number;
  of: number;
  startedAt: number;
};

/**
 * What the error itself will admit to, dug out of the shapes providers use.
 *
 * Deliberately generous about where a status can hide. The AI SDK wraps some
 * failures and passes others through, providers disagree about `status` versus
 * `statusCode`, and a wrapped error keeps the useful half in `cause` — so a
 * reader that checks one place finds nothing most of the time, which is
 * indistinguishable from there being nothing to find.
 */
export function failureFacts(error: unknown): { name: string; status: number | null; url: string | null; detail: string } {
  const seen = new Set<unknown>();
  let status: number | null = null;
  let url: string | null = null;
  let name = "Error";
  let detail = "";

  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const record = current as Record<string, unknown>;

    if (typeof record.name === "string" && name === "Error") name = record.name;
    if (typeof record.message === "string" && !detail) detail = record.message;

    for (const key of ["statusCode", "status", "code"]) {
      const value = record[key];
      if (status === null && typeof value === "number" && value >= 100 && value < 600) status = value;
    }
    if (url === null && typeof record.url === "string") url = record.url;

    current = record.cause;
  }

  return { name, status, url, detail: detail.slice(0, 300) };
}

/** One line per failed attempt, carrying everything needed to act on it. */
export function describeAttemptFailure(facts: AttemptFacts, error: unknown): string {
  const { name, status, url, detail } = failureFacts(error);
  return [
    `Navi Soul attempt ${facts.attempt}/${facts.of} failed:`,
    `engine=${facts.engine}`,
    `provider=${facts.provider}`,
    `model=${facts.model}`,
    `lane=${facts.lane}`,
    `dispatch=${facts.dispatch}`,
    `error=${name}`,
    status === null ? "status=none" : `status=${status}`,
    url ? `url=${url}` : "",
    `elapsedMs=${Date.now() - facts.startedAt}`,
    detail ? `detail=${JSON.stringify(detail)}` : ""
  ].filter(Boolean).join(" ");
}

/**
 * The same failure, carrying its attribution in the message.
 *
 * The original is kept as `cause` rather than replaced: the stack is still the
 * fastest way to the line that threw, and losing it to gain a label would trade
 * one kind of blindness for another. This only ensures that if this is the
 * error that finally surfaces — the one the aggregator clusters and a person
 * reads a week later — it says which engine produced it.
 */
export function attributedError(facts: AttemptFacts, error: unknown): Error {
  const { name, status, detail } = failureFacts(error);
  const attributed = new Error(
    `${facts.engine} (${facts.provider}/${facts.model}, lane ${facts.lane}, attempt ${facts.attempt}/${facts.of}) failed with ${name}`
    + `${status === null ? "" : ` ${status}`}${detail ? `: ${detail}` : ""}`,
    { cause: error }
  );
  attributed.name = "NaviAttemptError";
  return attributed;
}
