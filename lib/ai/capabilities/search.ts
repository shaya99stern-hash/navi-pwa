import { terms } from "../../memory";
import type { CapabilityManifest, CapabilityOperation } from "./manifest";

/**
 * Choosing the few operations that bear on a question, out of however many
 * have been added.
 *
 * This is the piece that decides whether "add any API" means a dozen or means
 * thousands. Tool schemas are prompt budget: the MCP bridge caps at 24 tools
 * for exactly that reason, and the app's own request-size accounting exists
 * because the system prompt is the largest single contributor to a turn. Handing
 * the model every operation of every added API would break the prompt somewhere
 * around the fortieth capability, and would break it by silently trimming
 * something else.
 *
 * So the manifests are an index rather than a toolset. Two tools exist no matter
 * how many APIs are added — one that searches this index, one that calls what it
 * found — and the schemas of individual operations are rendered as *text* on
 * demand, where they cost nothing until they are wanted.
 *
 * Lexical rather than embedding-based, and the tokenizer is the one
 * `lib/memory.ts` already uses to rank past conversations. Two tokenizers would
 * drift, and the second would be written from memory of the first. The same
 * trade applies as it does there: this costs no model call, no network and no
 * index to maintain, and it will rank worse on a pure paraphrase. Worth
 * revisiting only once that proves to be the thing that hurts.
 */

/** An API the owner added, with the credential and what they have approved. */
export type AddedCapability = {
  manifest: CapabilityManifest;
  /** Sent per request and never held on the server, like custom connectors. */
  apiKey: string;
  /**
   * Operation ids the owner has approved for writing, once.
   *
   * The gate is "ask once, then remember": a read is callable immediately, and
   * the first attempt at an operation that changes something asks. Approving it
   * puts its id here and it never asks again. Approval is per operation rather
   * than per API, because "you may read the calendar" and "you may delete from
   * the calendar" are not the same grant.
   */
  approvedWrites: string[];
};

export type OperationMatch = {
  capabilityId: string;
  capabilityName: string;
  operation: CapabilityOperation;
  score: number;
};

/** Results in one search. More than this is a list to scroll, not an answer. */
const MAX_MATCHES = 8;
/** Below this a match is a coincidence rather than a candidate. */
const MIN_SCORE = 0.5;

/**
 * Everything about an operation that a search could reasonably match on.
 *
 * The API's name and purpose are included on every one of its operations, so
 * "satellite imagery" finds `listImages` on an API called Imagery even though
 * the operation itself says neither word. Without that, an API is findable only
 * by the vocabulary of its endpoint summaries, which is the vocabulary its
 * authors used rather than the one the owner has.
 */
function haystack(capability: AddedCapability, operation: CapabilityOperation): string[] {
  return terms([
    capability.manifest.name,
    capability.manifest.purpose,
    operation.id,
    operation.summary,
    operation.path,
    ...operation.parameters.map((parameter) => `${parameter.name} ${parameter.description}`)
  ].join(" "));
}

/** The operations that bear on a question, best first. */
export function searchCapabilities(query: string, capabilities: AddedCapability[], limit = MAX_MATCHES): OperationMatch[] {
  const wanted = terms(query);
  if (!wanted.length) return [];
  const asked = new Set(wanted);

  const matches: OperationMatch[] = [];
  for (const capability of capabilities) {
    for (const operation of capability.manifest.operations) {
      const words = haystack(capability, operation);
      if (!words.length) continue;
      const present = new Set(words);
      let hits = 0;
      for (const word of asked) if (present.has(word)) hits += 1;
      if (!hits) continue;

      /* Normalised by how much was asked for rather than by how much the
         operation says, so a long summary does not out-rank a precise one by
         accident. A operation matching two of two terms beats one matching two
         of six. */
      const score = hits / asked.size;
      if (score < MIN_SCORE) continue;
      matches.push({
        capabilityId: capability.manifest.id,
        capabilityName: capability.manifest.name,
        operation,
        score
      });
    }
  }

  return matches
    /* Reads before writes at equal relevance. If both answer the question, the
       one that changes nothing is the one to try first — and the other one is
       going to stop and ask anyway. */
    .sort((a, b) => b.score - a.score || Number(a.operation.writes) - Number(b.operation.writes))
    .slice(0, Math.max(1, limit));
}

/** One operation, written out so the model can call it without a second look. */
export function describeOperation(match: OperationMatch, approved: boolean): string {
  const required = match.operation.parameters.filter((parameter) => parameter.required);
  const optional = match.operation.parameters.filter((parameter) => !parameter.required);
  const say = (parameter: { name: string; in: string; description: string; schema: Record<string, unknown> }) =>
    `${parameter.name} (${parameter.in}, ${typeof parameter.schema.type === "string" ? parameter.schema.type : "any"})${parameter.description ? ` — ${parameter.description}` : ""}`;

  return [
    `### ${match.capabilityId}.${match.operation.id}`,
    `${match.operation.method} ${match.operation.path} on ${match.capabilityName}. ${match.operation.summary}`,
    required.length ? `Required: ${required.map(say).join("; ")}` : "Required: nothing.",
    optional.length ? `Optional: ${optional.map(say).join("; ")}` : "",
    match.operation.body ? `Takes a JSON body: ${JSON.stringify(match.operation.body).slice(0, 600)}` : "",
    /* Said here rather than discovered at the call, so the model can choose a
       read when one would do instead of walking into a confirmation. */
    match.operation.writes
      ? approved
        ? "This one changes something. You have standing approval for it."
        : "This one changes something and has not been approved yet. Calling it will ask the owner first, once."
      : "This one only reads."
  ].filter(Boolean).join("\n");
}

/** The whole answer to a search, or an honest account of finding nothing. */
export function describeMatches(query: string, matches: OperationMatch[], capabilities: AddedCapability[]): string {
  if (!capabilities.length) {
    return "No APIs have been added to this deployment yet. They are added on the Connectors screen.";
  }
  if (!matches.length) {
    const names = capabilities.map((capability) => capability.manifest.name).join(", ");
    /* Naming what *is* there turns a dead end into a next step: the owner can
       see immediately whether the API they meant is missing or merely worded
       differently from how they asked. */
    /* When an API was clipped at discovery, "no match" has a second possible
       cause worth naming: the operation may exist and simply not have been
       kept. Without this the only available answer is "this API cannot do
       that", which is a confident claim about operations nobody looked at. */
    const clipped = capabilities
      .map((capability) => capability.manifest)
      .filter((manifest) => manifest.truncated)
      .map((manifest) => `${manifest.name} (${manifest.truncated!.kept} of ${manifest.truncated!.declared} operations kept)`);
    const caveat = clipped.length
      ? ` Note that ${clipped.join(", ")} — so an operation that exists in its documentation may not have been kept, and "not found here" is not the same as "not offered by that API".`
      : "";
    return `Nothing among the added APIs matches “${query}”. What is available: ${names}.${caveat} Say so rather than guessing at an endpoint that may not exist.`;
  }

  const approved = new Map(capabilities.map((capability) => [capability.manifest.id, new Set(capability.approvedWrites)]));
  return [
    `${matches.length} operation${matches.length === 1 ? "" : "s"} may bear on “${query}”, most relevant first.`,
    "",
    ...matches.map((match) => describeOperation(match, approved.get(match.capabilityId)?.has(match.operation.id) ?? false)),
    "",
    "Call one with `call_capability`, passing the capability id, the operation id, and the arguments named above. Do not invent an operation that is not listed here."
  ].join("\n");
}

/** Whether this operation may be called without asking the owner first. */
export function isApproved(capability: AddedCapability, operation: CapabilityOperation): boolean {
  if (!operation.writes) return true;
  return capability.approvedWrites.includes(operation.id);
}
