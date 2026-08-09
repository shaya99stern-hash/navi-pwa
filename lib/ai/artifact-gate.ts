import { recoverArtifactPayload, validateArtifactPayload } from "../security/artifacts";

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

/**
 * The aliased fences models actually emit, held and normalised like the real
 * one. Without this an `artifact`-labelled payload streamed to the reader as
 * raw JSON and was only converted to a card once the message was re-rendered
 * from storage — so the answer looked broken exactly while it was arriving.
 *
 * Longest first: the scanner takes the earliest match, and `artifact` is a
 * suffix of `navi-artifact`.
 */
const ALIAS_FENCES = [
  "```navi-artifact",
  "```react-component",
  "```react_component",
  "```html-artifact",
  "```naviartifact",
  "```navi-html",
  "```artifacts",
  "```artifact"
];

/** The earliest alias fence in the buffer, and which one it was. */
function findFence(buffer: string): { index: number; fence: string } | null {
  let best: { index: number; fence: string } | null = null;
  for (const fence of ALIAS_FENCES) {
    const index = buffer.indexOf(fence);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && fence.length > best.fence.length)) {
      best = { index, fence };
    }
  }
  return best;
}

/** The longest alias, for deciding how much tail to hold across deltas. */
const MAX_FENCE_LENGTH = Math.max(...ALIAS_FENCES.map((fence) => fence.length));

export type ArtifactGate = {
  /** Text from this delta that is safe to show now. May be empty. */
  push: (delta: string) => string;
  /** Anything still held when the stream ends. */
  flush: () => string;
};

function validateBlock(block: string, fence: string): string {
  const inner = block.slice(fence.length, block.length - CLOSE.length).trim();

  /* Exactly right already, and already the canonical fence: pass it through
     byte-for-byte. An alias is always rewritten, even when its payload is
     perfect, because only the canonical fence renders as a card. */
  try {
    if (validateArtifactPayload(JSON.parse(inner)).ok && fence === FENCE) return block;
  } catch { /* fall through to salvage */ }

  /* Not exactly right: salvage what the model meant — sloppy JSON, aliased
     kinds, raw markup — and re-emit it as a canonical fence. Only when there
     is genuinely nothing renderable does the reader see a notice instead. */
  const recovered = recoverArtifactPayload(inner);
  if (recovered.ok) return `\`\`\`navi-artifact\n${JSON.stringify(recovered.payload)}\n\`\`\``;
  return tolerantlyParsed(inner)
    ? `\n> NaviSoul removed an invalid artifact payload: ${recovered.error}\n`
    : "\n> NaviSoul removed a malformed artifact payload.\n";
}

/** Whether the fence at least contained JSON, for the honesty of the notice. */
function tolerantlyParsed(inner: string): boolean {
  try { JSON.parse(inner.slice(inner.indexOf("{"), inner.lastIndexOf("}") + 1)); return true; } catch { return false; }
}

export function createArtifactGate(): ArtifactGate {
  let buffer = "";
  let openFence: string | null = null;

  return {
    push(delta) {
      buffer += delta;
      let out = "";

      for (;;) {
        if (!openFence) {
          const found = findFence(buffer);
          if (!found) {
            /* The fence marker can straddle two deltas, so the tail is held
               back until enough has arrived to rule one out. Without this a
               fence split across chunks is never recognised. */
            const keep = Math.max(0, buffer.length - (MAX_FENCE_LENGTH - 1));
            out += buffer.slice(0, keep);
            buffer = buffer.slice(keep);
            return out;
          }
          out += buffer.slice(0, found.index);
          buffer = buffer.slice(found.index);
          openFence = found.fence;
        }

        const end = buffer.indexOf(CLOSE, openFence.length);
        // Still open: hold everything until the payload can be validated.
        if (end === -1) return out;

        out += validateBlock(buffer.slice(0, end + CLOSE.length), openFence);
        buffer = buffer.slice(end + CLOSE.length);
        openFence = null;
      }
    },

    flush() {
      const held = buffer;
      buffer = "";
      if (!openFence) return held;
      openFence = null;
      /* The stream ended mid-payload. Releasing it would render a broken card
         from JSON that was never validated, so it is dropped and said so. */
      return "\n> NaviSoul removed an incomplete artifact payload.\n";
    }
  };
}
