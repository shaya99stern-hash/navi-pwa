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

/**
 * Everything the shared tokenizer cannot see, added before it runs.
 *
 * ## Why this layer exists
 *
 * The owner put it plainly: *"it has to know that let's say I saved a certain
 * way, it has to know variants of that. It can't be... it has to be that
 * exact."* They are describing the gap between the words a person uses and the
 * words an API's authors used, and there were three of them.
 *
 * **Identifiers were invisible.** `terms()` strips punctuation *before* it
 * splits on whitespace, so `listImages` arrives as the single token
 * `listimages` and `/v1/images/{id}` as `v1 images id`. The operation id is the
 * most semantically loaded field an operation has, and no query could ever
 * match it — "list images" found nothing on an operation literally called
 * `listImages`.
 *
 * **Plurals were different words.** `image` and `images` shared no token, so
 * whether a search worked depended on whether the owner happened to use the
 * same number as the spec's author.
 *
 * **Verbs did not meet.** Somebody asking to *delete* something never reached
 * an operation called `removeImage`. This is the most predictable vocabulary
 * mismatch in the whole domain and the easiest to bridge.
 *
 * ## Which side gets which expansion
 *
 * Deliberately asymmetric. The haystack gets synonyms; the query does not.
 *
 * Expanding both sides multiplies: every query verb would reach every
 * operation verb, and a search for "delete" would rank a `create` endpoint as a
 * candidate. Expanding only the index means the index is generous about how it
 * can be *addressed*, while the question stays exactly what was asked.
 *
 * Stems go on both, because a stem is the same word rather than a related one.
 */

/** `listImages` → `list Images`; `get_user_by_id` → `get user by id`. */
function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ");
}

/**
 * Enough stemming to make a plural the same word, and no more.
 *
 * A real stemmer would collapse pairs that mean different things here —
 * `billing` and `bill` are one word to Porter and two to an API. This handles
 * the endings that actually differ between how a person types and how a spec is
 * written, and leaves everything else alone.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const ending of ["ies", "es", "s"]) {
    if (word.endsWith(ending)) {
      const base = word.slice(0, -ending.length);
      if (base.length >= 3) return ending === "ies" ? `${base}y` : base;
    }
  }
  return word;
}

/**
 * The verbs APIs are named with, against the verbs people ask with.
 *
 * Narrow on purpose. Every entry here is a pair that genuinely means the same
 * operation, and nothing aspirational: a synonym list that grows past what is
 * certain starts matching things the owner did not ask for, which is worse than
 * the miss it was added to fix.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  list: ["get", "show", "find", "search", "read", "all", "fetch", "browse"],
  get: ["fetch", "read", "show", "retrieve", "lookup", "find"],
  create: ["add", "new", "make", "post", "insert", "upload"],
  update: ["edit", "change", "modify", "set", "patch", "rename"],
  delete: ["remove", "destroy", "drop", "erase", "cancel"],
  send: ["post", "submit", "dispatch", "deliver"],
  image: ["picture", "photo", "img", "imagery"],
  user: ["account", "person", "profile", "member"],
  file: ["document", "doc", "attachment"]
};

/* Read in both directions: an operation called `remove` should be reachable by
   someone typing "delete", and one called `delete` by someone typing "remove". */
const SYNONYM_INDEX = ((): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const existing = index.get(from) ?? [];
    if (!existing.includes(to)) index.set(from, [...existing, to]);
  };
  for (const [word, others] of Object.entries(SYNONYMS)) {
    for (const other of others) { add(word, other); add(other, word); }
  }
  return index;
})();

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
function expand(text: string): Set<string> {
  /* The index is generous about how it can be addressed; the query stays
     exactly what was asked. See the note on `SYNONYMS`. */
  const expanded = new Set<string>();
  for (const word of terms(splitIdentifiers(text))) {
    expanded.add(word);
    expanded.add(stem(word));
    for (const synonym of SYNONYM_INDEX.get(word) ?? []) {
      expanded.add(synonym);
      expanded.add(stem(synonym));
    }
  }
  return expanded;
}

/**
 * What this operation says about itself, and what its API says about all of
 * them — kept apart, because they are not equally strong evidence.
 *
 * The API's name and purpose ride on every one of its operations, and that is
 * deliberate: without it an API is findable only by the vocabulary of its
 * endpoint summaries, which is its authors' vocabulary rather than the owner's.
 * "Satellite imagery" has to reach `listImages` on an API called Imagery even
 * though the operation says neither word.
 *
 * But identity is shared by every operation equally, so it can never
 * *distinguish* between them — and once synonyms were added it became strong
 * enough to clear the bar on its own. Asking to delete an image then surfaced
 * the endpoint that creates reports, because both belong to an API whose
 * purpose mentions pictures. Identity is what gets an API into the running;
 * what the operation itself says is what decides which one answers.
 */
function haystack(capability: AddedCapability, operation: CapabilityOperation): { own: Set<string>; identity: Set<string> } {
  return {
    own: expand([
      operation.id,
      operation.summary,
      operation.path,
      ...operation.parameters.map((parameter) => `${parameter.name} ${parameter.description}`)
    ].join(" ")),
    identity: expand(`${capability.manifest.name} ${capability.manifest.purpose}`)
  };
}

/** A shared word is real evidence, and weaker than the operation's own. */
const IDENTITY_WEIGHT = 0.5;

/** The operations that bear on a question, best first. */
export function searchCapabilities(query: string, capabilities: AddedCapability[], limit = MAX_MATCHES): OperationMatch[] {
  /* Identifiers split on the query side too: somebody who pastes an operation
     name is asking about that operation, and it would be strange for the one
     phrasing guaranteed to be right to be the one that fails. */
  const wanted = terms(splitIdentifiers(query));
  if (!wanted.length) return [];
  const asked = new Set(wanted);

  const matches: OperationMatch[] = [];
  for (const capability of capabilities) {
    for (const operation of capability.manifest.operations) {
      const { own, identity } = haystack(capability, operation);
      if (!own.size && !identity.size) continue;
      /* A word counts if it is there, or if its stem is — a stem is the same
         word rather than a related one, so this loosens nothing. */
      const holds = (words: Set<string>, word: string) => words.has(word) || words.has(stem(word));
      let hits = 0;
      for (const word of asked) {
        if (holds(own, word)) hits += 1;
        else if (holds(identity, word)) hits += IDENTITY_WEIGHT;
      }
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
