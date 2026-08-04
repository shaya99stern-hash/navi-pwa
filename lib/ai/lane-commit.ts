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

/** Chunk types that mean this lane has produced something a person would see. */
export const COMMITTING_CHUNK_TYPES = new Set([
  "text-delta",
  "reasoning-delta",
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
