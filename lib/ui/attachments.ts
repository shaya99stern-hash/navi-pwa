"use client";

/**
 * The chat route runs on the Edge runtime, which rejects request bodies over
 * 4 MB before any application code runs. Attachments travel as base64 data
 * URLs, so every raw byte costs about 1.34 on the wire, and the conversation
 * itself has to fit in the same body.
 *
 * The composer used to advertise 6 MB per file and 10 MB total, which the
 * platform could never deliver — a single large photo failed with no useful
 * error. These limits are what actually fits, and images are resized to reach
 * it rather than being refused.
 */
const EDGE_BODY_LIMIT = 4_000_000;
const CONVERSATION_RESERVE = 400_000;
const BASE64_OVERHEAD = 4 / 3;

/** Total raw attachment bytes that survive base64 expansion inside the cap. */
export const ATTACHMENT_BUDGET = Math.floor((EDGE_BODY_LIMIT - CONVERSATION_RESERVE) / BASE64_OVERHEAD);

export const MAX_ATTACHMENTS = 6;
/** Images are resized, so the input limit only needs to bound decode cost. */
export const MAX_IMAGE_INPUT_BYTES = 30_000_000;

/** Beyond this the vision models downsample anyway, so the pixels are wasted. */
const MAX_IMAGE_EDGE = 1568;
/**
 * Editing a document is different: the model has to reproduce small printed
 * digits character for character, and it cannot preserve what the resize
 * already destroyed. Detail mode trades request budget for legibility.
 */
const MAX_IMAGE_EDGE_DETAIL = 2560;
const QUALITY_STEPS = [0.82, 0.7, 0.58, 0.45];
const QUALITY_STEPS_DETAIL = [0.96, 0.92, 0.85, 0.72];

const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isResizableImage(file: File): boolean {
  return RESIZABLE.has(file.type);
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  // Safari silently falls back to PNG for formats it cannot encode, which would
  // defeat the whole point, so confirm the type it actually produced.
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (webp?.type === "image/webp") return webp;
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Shrink an image until it fits `targetBytes`, trading resolution and then
 * quality. Returns the original when it already fits or cannot be decoded —
 * a failed resize should not lose the user's attachment.
 */
export async function downscaleImage(file: File, targetBytes: number, preserveDetail = false): Promise<File> {
  if (!isResizableImage(file)) return file;
  const maxEdge = preserveDetail ? MAX_IMAGE_EDGE_DETAIL : MAX_IMAGE_EDGE;
  const qualitySteps = preserveDetail ? QUALITY_STEPS_DETAIL : QUALITY_STEPS;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    let scale = Math.min(1, maxEdge / longest);
    if (scale === 1 && file.size <= targetBytes) return file;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const quality = qualitySteps[Math.min(attempt, qualitySteps.length - 1)];
      const blob = await encode(canvas, quality);
      if (!blob) return file;
      if (blob.size <= targetBytes) {
        const extension = blob.type === "image/webp" ? "webp" : "jpg";
        const name = file.name.replace(/\.[^.]+$/, "") || "image";
        return new File([blob], `${name}.${extension}`, { type: blob.type, lastModified: file.lastModified });
      }
      // Past the quality steps, keep halving the pixel count instead.
      if (attempt >= qualitySteps.length - 1) scale *= 0.7;
    }
    return file;
  } finally {
    bitmap.close?.();
  }
}

export type PreparedAttachments = {
  files: File[];
  /** Non-fatal notes worth showing, e.g. that a photo was resized. */
  notice: string | null;
};

function describe(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.round(bytes / 1_000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Fit a set of attachments into the request budget, resizing images as needed.
 * Throws with a user-facing message when files that cannot be resized still do
 * not fit, since silently dropping an attachment would be worse.
 */
export async function prepareAttachments(files: File[], preserveDetail = false): Promise<PreparedAttachments> {
  if (!files.length) return { files, notice: null };

  const fixed = files.filter((file) => !isResizableImage(file));
  const images = files.filter(isResizableImage);
  const fixedBytes = fixed.reduce((sum, file) => sum + file.size, 0);

  if (fixedBytes > ATTACHMENT_BUDGET) {
    throw new Error(
      `Documents total ${describe(fixedBytes)}, over the ${describe(ATTACHMENT_BUDGET)} request limit. Remove one and try again.`
    );
  }

  const imageBudget = ATTACHMENT_BUDGET - fixedBytes;
  if (!images.length) return { files, notice: null };
  if (imageBudget <= 0) {
    throw new Error(`The attached documents leave no room for images. Send them in separate messages.`);
  }

  const perImage = Math.floor(imageBudget / images.length);
  const resized = await Promise.all(images.map((file) => downscaleImage(file, perImage, preserveDetail)));
  const shrunk = resized.filter((file, index) => file !== images[index]);

  const total = fixedBytes + resized.reduce((sum, file) => sum + file.size, 0);
  if (total > ATTACHMENT_BUDGET) {
    throw new Error(
      `Attachments total ${describe(total)} after resizing, over the ${describe(ATTACHMENT_BUDGET)} request limit.`
    );
  }

  // Keep the caller's original ordering; only the images were replaced.
  let next = 0;
  const merged = files.map((file) => (isResizableImage(file) ? resized[next++] : file));

  return {
    files: merged,
    notice: shrunk.length
      ? `${shrunk.length === 1 ? "Image" : `${shrunk.length} images`} resized to fit the request limit.`
      : null
  };
}
