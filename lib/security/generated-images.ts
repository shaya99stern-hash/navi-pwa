import type { GeneratedImagePayload } from "../ai/types";

const MAX_IMAGE_BYTES = 10_000_000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED_MIME_TYPES = new Set<GeneratedImagePayload["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export function validateGeneratedImagePayload(
  value: unknown
): { ok: true; payload: GeneratedImagePayload } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Image payload must be an object." };
  const candidate = value as Partial<GeneratedImagePayload>;

  if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) {
    return { ok: false, error: "Image id is invalid." };
  }
  if (typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 120) {
    return { ok: false, error: "Image title is invalid." };
  }
  if (typeof candidate.alt !== "string" || candidate.alt.trim().length < 1 || candidate.alt.length > 300) {
    return { ok: false, error: "Image description is invalid." };
  }
  if (!candidate.mimeType || !ALLOWED_MIME_TYPES.has(candidate.mimeType)) {
    return { ok: false, error: "Image format is unsupported." };
  }
  if (typeof candidate.data !== "string" || candidate.data.length < 100 || !BASE64_PATTERN.test(candidate.data)) {
    return { ok: false, error: "Image data is invalid." };
  }

  const estimatedBytes = Math.ceil(candidate.data.length * 0.75);
  if (estimatedBytes > MAX_IMAGE_BYTES) return { ok: false, error: "Generated image is too large." };

  const width = typeof candidate.width === "number" && Number.isFinite(candidate.width)
    ? Math.min(4096, Math.max(128, Math.round(candidate.width)))
    : undefined;
  const height = typeof candidate.height === "number" && Number.isFinite(candidate.height)
    ? Math.min(4096, Math.max(128, Math.round(candidate.height)))
    : undefined;

  return {
    ok: true,
    payload: {
      id: candidate.id,
      title: candidate.title.trim(),
      alt: candidate.alt.trim(),
      mimeType: candidate.mimeType,
      data: candidate.data,
      prompt: typeof candidate.prompt === "string" ? candidate.prompt.slice(0, 4_000) : candidate.alt.trim(),
      width,
      height
    }
  };
}
