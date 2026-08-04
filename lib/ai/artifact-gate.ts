import { validateArtifactPayload } from "../security/artifacts";

/**
 * Hold back artifact payloads while the rest of an answer streams.
 *
 * Streaming an answer means the user reads it as it arrives, which is the whole
 * point — but an artifact is a fenced JSON object that gets rendered as an
 * interactive card, and half of one is not a card, it is a wall of raw JSON
 * that later disappears. It also cannot be validated until it is complete, and
 * an unvalidated payload is exactly what the security check exists to stop.
 *
 * So prose flows through untouched and artifact fences are buffered until they
 * close, validated, and then released whole. Nothing the user has read is ever
 * retracted, because nothing is emitted until it is safe to keep.
 */

const FENCE = "```navi-artifact";
const CLOSE = "```";

export type ArtifactGate = {
  /** Text from this delta that is safe to show now. May be empty. */
  push: (delta: string) => string;
  /** Anything still held when the stream ends. */
  flush: () => string;
};

function validateBlock(block: string): string {
  const inner = block.slice(FENCE.length, block.length - CLOSE.length);
  try {
    const validation = validateArtifactPayload(JSON.parse(inner.trim()));
    return validation.ok ? block : `\n> NaviSol removed an invalid artifact payload: ${validation.error}\n`;
  } catch {
    return "\n> NaviSol removed a malformed artifact payload.\n";
  }
}

export function createArtifactGate(): ArtifactGate {
  let buffer = "";
  let inFence = false;

  return {
    push(delta) {
      buffer += delta;
      let out = "";

      for (;;) {
        if (!inFence) {
          const start = buffer.indexOf(FENCE);
          if (start === -1) {
            /* The fence marker can straddle two deltas, so the tail is held
               back until enough has arrived to rule one out. Without this a
               fence split across chunks is never recognised. */
            const keep = Math.max(0, buffer.length - (FENCE.length - 1));
            out += buffer.slice(0, keep);
            buffer = buffer.slice(keep);
            return out;
          }
          out += buffer.slice(0, start);
          buffer = buffer.slice(start);
          inFence = true;
        }

        const end = buffer.indexOf(CLOSE, FENCE.length);
        // Still open: hold everything until the payload can be validated.
        if (end === -1) return out;

        out += validateBlock(buffer.slice(0, end + CLOSE.length));
        buffer = buffer.slice(end + CLOSE.length);
        inFence = false;
      }
    },

    flush() {
      const held = buffer;
      buffer = "";
      if (!inFence) return held;
      inFence = false;
      /* The stream ended mid-payload. Releasing it would render a broken card
         from JSON that was never validated, so it is dropped and said so. */
      return "\n> NaviSol removed an incomplete artifact payload.\n";
    }
  };
}
