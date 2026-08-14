import { validateArtifactPayload } from "../security/artifacts";
import { assessArtifact } from "./navi-soul/artifact-quality";

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

/**
 * Any fence whose label mentions an artifact, not just the enumerated ones.
 *
 * A real reply arrived labelled `naviopi-artifact`, which no list would have
 * contained, and it streamed to the reader as raw JSON. The list above stays
 * because it also covers labels that do *not* contain the word — `navi-html`,
 * `react-component` — but the general case is now the pattern.
 */
const FENCE_PATTERN = /```[a-z0-9_-]*artifact[a-z0-9_-]*/i;

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
  const loose = FENCE_PATTERN.exec(buffer);
  if (loose && (!best || loose.index < best.index || (loose.index === best.index && loose[0].length > best.fence.length))) {
    best = { index: loose.index, fence: loose[0] };
  }
  return best;
}

/* The longest alias, for deciding how much tail to hold across deltas. The
   pattern can match longer labels than any listed alias, so the bound is
   generous rather than exact — holding a few extra characters costs a frame of
   latency, while holding too few lets a split fence through unrecognised. */
const MAX_FENCE_LENGTH = Math.max(...ALIAS_FENCES.map((fence) => fence.length)) + 12;

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
    if (validateArtifactPayload(JSON.parse(inner)).ok && fence === FENCE && assessArtifact(inner).ok) return block;
  } catch { /* fall through to salvage */ }

  /* Not exactly right: salvage what the model meant — sloppy JSON, aliased
     kinds, raw markup — and re-emit it as a canonical fence. Only when there
     is genuinely nothing renderable does the reader see a notice instead. */
  const assessed = assessArtifact(inner);
  if (assessed.ok) return `\`\`\`navi-artifact\n${JSON.stringify(assessed.payload)}\n\`\`\``;
  return tolerantlyParsed(inner)
    ? `\n> Navi Soul removed an invalid artifact payload: ${assessed.error}\n`
    : "\n> Navi Soul removed a malformed artifact payload.\n";
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
      return "\n> Navi Soul removed an incomplete artifact payload.\n";
    }
  };
}
