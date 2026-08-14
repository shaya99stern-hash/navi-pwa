/* PATH: lib/ai/navi-soul/image-preflight.ts  — NEW FILE, copy verbatim. */

/**
 * Proof that a generated image is an image, before it is kept or shown.
 *
 * A provider under quota pressure returns an error body; a truncated stream
 * returns half a file; a proxy returns an HTML error page. All of them arrive
 * at the same place a real picture does — a base64 string — and the card that
 * renders them shows a broken image icon after the user already watched the
 * generation spinner succeed. That is the "bad image" failure, and it is
 * detectable in microseconds by reading the first bytes.
 *
 * Validation is deterministic and local: charset, decodability, magic bytes,
 * and a size floor. A declared mime type that disagrees with the magic bytes
 * is corrected rather than failed, because the picture is real and the label
 * is the part that is wrong. `generateNaviImage`'s engine fallback already
 * knows what to do with a failure — this gives it one it can trust.
 */

export type ImagePreflight =
  | { ok: true; mimeType: "image/png" | "image/jpeg" | "image/webp"; bytes: number; corrected: boolean }
  | { ok: false; error: string };

/** ~1.5 KB decoded. Below this it is an error body, not a picture. */
const MIN_BYTES = 1_500;
/** Above this the store and the message renderer both suffer. */
const MAX_BYTES = 20 * 1024 * 1024;

const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeHead(data: string, count: number): Uint8Array | null {
  try {
    const head = atob(data.slice(0, Math.ceil(count / 3) * 4 + 4));
    const bytes = new Uint8Array(Math.min(head.length, count));
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = head.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** The formats the payload contract admits, identified by their own bytes. */
export function sniffImageFormat(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  return null;
}

export function validateGeneratedImage(payload: { data: string; mimeType: string }): ImagePreflight {
  const data = payload.data?.replace(/\s+/g, "") ?? "";
  if (!data) return { ok: false, error: "The engine returned no image data." };

  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes < MIN_BYTES) return { ok: false, error: "The engine returned something too small to be an image — likely an error body." };
  if (bytes > MAX_BYTES) return { ok: false, error: "The engine returned an image too large to store on this device." };

  if (!BASE64_SHAPE.test(data.slice(0, 400))) {
    return { ok: false, error: "The engine returned data that is not base64 — likely an error page." };
  }

  const head = decodeHead(data, 16);
  if (!head) return { ok: false, error: "The engine returned base64 that does not decode." };

  const detected = sniffImageFormat(head);
  if (!detected) return { ok: false, error: "The engine returned bytes that are not a PNG, JPEG, or WebP image." };
  if (detected === "image/gif") return { ok: false, error: "The engine returned a GIF, which the image contract does not carry." };

  /* The picture is real; a wrong label is corrected, not punished. A payload
     stored with the wrong mime type renders on some platforms and not others,
     which is the most confusing version of broken. */
  return { ok: true, mimeType: detected, bytes, corrected: detected !== payload.mimeType };
}
