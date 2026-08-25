/**
 * Deciding when a provider lane has actually answered.
 *
 * The chat route tries several providers in turn, and a failure is only
 * recoverable while nothing has reached the screen. Getting that boundary
 * wrong is what made the fallback look like it only covered rate limits: the
 * route committed on the stream's first chunk, which is `start` — emitted
 * before the provider has produced anything — so every failure that arrived a
 * moment later surfaced as an error card instead of falling through.
 *
 * This lives on its own so the boundary can be tested against real chunk
 * sequences rather than inferred from a live provider.
 */

/**
 * Chunk types that mean this lane has produced something a person would see.
 *
 * `reasoning-delta` is deliberately absent. On a reasoning model the *first*
 * chunk of every stream is reasoning, so counting it here committed the lane
 * before a single character of answer existed — which quietly disabled
 * fallback for exactly the models most likely to need it. A failure arriving
 * at step two then surfaced as half an answer plus an error card instead of a
 * clean switch to a healthy provider.
 *
 * Reasoning is intermediate work, not the answer, and it is buffered as
 * preamble and replayed the moment the lane does commit — so nothing is lost
 * visually, and `MAX_PREAMBLE_CHUNKS` still bounds how long a lane may
 * deliberate before it is treated as committed anyway.
 */
export const COMMITTING_CHUNK_TYPES = new Set([
  "text-delta",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-available",
  "tool-output-available",
  "file",
  "source-url",
  "source-document"
]);

/**
 * A lane that emits this much preamble without content is treated as committed
 * anyway. Delivering an odd stream beats spinning on a reader that may never
 * produce a chunk this loop recognises.
 */
export const MAX_PREAMBLE_CHUNKS = 24;

export type StreamChunk = { type?: string; errorText?: string };

export type LaneCommit = {
  /** True once the lane produced content, or emitted more preamble than the cap. */
  committed: boolean;
  /** Chunks read before committing. Replayed to the writer when committed. */
  preamble: StreamChunk[];
  /** Why the lane failed, when it failed before committing. */
  failure: Error | null;
};

export function isCommittingChunk(chunk: StreamChunk): boolean {
  return Boolean(chunk.type && COMMITTING_CHUNK_TYPES.has(chunk.type));
}

/**
 * Read from `reader` until the lane commits or fails, buffering the preamble.
 *
 * The reader is left open on success so the caller can release the lock and
 * merge the remainder; on failure it is cancelled, since nobody will read it.
 */
export async function readUntilCommitted(
  reader: ReadableStreamDefaultReader<unknown>
): Promise<LaneCommit> {
  const preamble: StreamChunk[] = [];

  for (;;) {
    if (preamble.length >= MAX_PREAMBLE_CHUNKS) return { committed: true, preamble, failure: null };

    const next = await reader.read();
    if (next.done) {
      await reader.cancel().catch(() => {});
      return { committed: false, preamble, failure: new Error("The provider closed without answering.") };
    }

    const chunk = (next.value ?? {}) as StreamChunk;
    /* An error part, not a rejection: the UI message stream turns a provider
       failure into a chunk, so a bare try/catch never sees the most common way
       a lane dies. */
    if (chunk.type === "error") {
      await reader.cancel().catch(() => {});
      return { committed: false, preamble, failure: new Error(chunk.errorText || "The provider returned an error.") };
    }

    preamble.push(chunk);
    if (isCommittingChunk(chunk)) return { committed: true, preamble, failure: null };
  }
}
