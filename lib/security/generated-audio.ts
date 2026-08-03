import type { AudioKind, GeneratedAudioPayload } from "../ai/audio-generation";

/**
 * Audio arrives as base64 inside a fenced block in the model's own output, so
 * it is treated as untrusted input and validated before it reaches an <audio>
 * element — the same posture as generated images.
 */

/** Roughly a minute of uncompressed stereo, which no clip here should exceed. */
const MAX_AUDIO_BYTES = 12_000_000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED_MIME_TYPES = new Set<GeneratedAudioPayload["mimeType"]>([
  "audio/wav",
  "audio/mpeg",
  "audio/flac",
  "audio/ogg"
]);
const ALLOWED_KINDS = new Set<AudioKind>(["music", "effect", "speech"]);

export function validateGeneratedAudioPayload(
  value: unknown
): { ok: true; payload: GeneratedAudioPayload } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Audio payload must be an object." };
  const candidate = value as Partial<GeneratedAudioPayload>;

  if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) {
    return { ok: false, error: "Audio id is invalid." };
  }
  if (typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 160) {
    return { ok: false, error: "Audio title is invalid." };
  }
  if (!candidate.kind || !ALLOWED_KINDS.has(candidate.kind)) {
    return { ok: false, error: "Audio kind is invalid." };
  }
  if (!candidate.mimeType || !ALLOWED_MIME_TYPES.has(candidate.mimeType)) {
    return { ok: false, error: "Audio format is unsupported." };
  }
  if (typeof candidate.data !== "string" || candidate.data.length < 100 || !BASE64_PATTERN.test(candidate.data)) {
    return { ok: false, error: "Audio data is invalid." };
  }

  const estimatedBytes = Math.ceil(candidate.data.length * 0.75);
  if (estimatedBytes > MAX_AUDIO_BYTES) return { ok: false, error: "Generated audio is too large." };

  const durationSeconds = typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds)
    ? Math.min(120, Math.max(1, Math.round(candidate.durationSeconds)))
    : undefined;

  return {
    ok: true,
    payload: {
      id: candidate.id,
      title: candidate.title.trim(),
      engine: typeof candidate.engine === "string" && candidate.engine.trim() ? candidate.engine.trim().slice(0, 40) : "Navi Sound",
      kind: candidate.kind,
      mimeType: candidate.mimeType,
      data: candidate.data,
      prompt: typeof candidate.prompt === "string" ? candidate.prompt.slice(0, 4_000) : candidate.title.trim(),
      durationSeconds
    }
  };
}
