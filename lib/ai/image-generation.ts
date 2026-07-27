import type { GeneratedImagePayload } from "./types";

export type ImageAttachment = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
};

type ImageDimensions = {
  aspectRatio: "1:1" | "3:2" | "2:3" | "4:5" | "5:4" | "9:16" | "16:9";
  width: number;
  height: number;
};

type ImageBlock = {
  data: string;
  mimeType: GeneratedImagePayload["mimeType"];
};

function usableSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  if (!secret || /^(?:undefined|null|none|changeme|your[_ -]?key)$/i.test(secret)) return undefined;
  return secret;
}

function normalizedEnvironmentKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findEnvironmentSecret(
  explicitValues: Array<string | undefined>,
  keyMatcher: (normalizedKey: string) => boolean,
  valuePrefix: string
): string | undefined {
  for (const value of explicitValues) {
    const secret = usableSecret(value);
    if (secret) return secret;
  }
  for (const [key, rawValue] of Object.entries(process.env)) {
    const value = usableSecret(rawValue);
    if (value && keyMatcher(normalizedEnvironmentKey(key))) return value;
  }
  for (const rawValue of Object.values(process.env)) {
    const value = usableSecret(rawValue);
    if (value?.startsWith(valuePrefix)) return value;
  }
  return undefined;
}

function geminiApiKey(): string | undefined {
  return findEnvironmentSecret(
    [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_KEY,
      process.env.GOOGLE_GEMINI_API_KEY,
      process.env.GOOGLE_AI_API_KEY,
      process.env.GOOGLE_API_KEY
    ],
    (key) => key.includes("GEMINI") && (key.includes("KEY") || key.includes("TOKEN")),
    "AIza"
  );
}

function huggingFaceToken(): string | undefined {
  return findEnvironmentSecret(
    [
      process.env.HF_TOKEN,
      process.env.HF_API_TOKEN,
      process.env.HF_API_KEY,
      process.env.HF_ACCESS_TOKEN,
      process.env.HUGGINGFACE_API_KEY,
      process.env.HUGGING_FACE_API_KEY,
      process.env.HUGGINGFACE_TOKEN,
      process.env.HUGGING_FACE_TOKEN,
      process.env.HUGGINGFACE_HUB_TOKEN,
      process.env.HUGGING_FACE_HUB_TOKEN,
      process.env.HUGGINGFACE_ACCESS_TOKEN,
      process.env.HUGGING_FACE_ACCESS_TOKEN
    ],
    (key) => (key.includes("HUGGINGFACE") || key.startsWith("HF")) && (key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET")),
    "hf_"
  );
}

function inferDimensions(prompt: string): ImageDimensions {
  const lower = prompt.toLowerCase();
  if (/\b(phone wallpaper|iphone wallpaper|story|reel|9[:x]16|vertical poster)\b/.test(lower)) {
    return { aspectRatio: "9:16", width: 768, height: 1344 };
  }
  if (/\b(widescreen|cinematic|banner|youtube|landscape wallpaper|16[:x]9)\b/.test(lower)) {
    return { aspectRatio: "16:9", width: 1344, height: 768 };
  }
  if (/\b(landscape|panorama|3[:x]2)\b/.test(lower)) {
    return { aspectRatio: "3:2", width: 1152, height: 768 };
  }
  if (/\b(portrait|person|boy|girl|man|woman|character|full body|4[:x]5)\b/.test(lower)) {
    return { aspectRatio: "4:5", width: 896, height: 1120 };
  }
  if (/\b(tall|poster|book cover|2[:x]3)\b/.test(lower)) {
    return { aspectRatio: "2:3", width: 768, height: 1152 };
  }
  if (/\b(horizontal|5[:x]4)\b/.test(lower)) {
    return { aspectRatio: "5:4", width: 1120, height: 896 };
  }
  return { aspectRatio: "1:1", width: 1024, height: 1024 };
}

function polishedPrompt(prompt: string): string {
  return [
    prompt.trim(),
    "Create a complete, professionally composed raster image with coherent anatomy, intentional lighting, strong detail, and a finished visual style.",
    "Do not output SVG, clip art, diagrams, UI chrome, captions, borders, or watermarks unless explicitly requested."
  ].join("\n\n");
}

function imageTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(?:please\s+)?(?:generate|create|make|draw|render|design)\b/gi, "")
    .replace(/\b(?:an?|the)\s+(?:image|picture|photo|illustration)\s+(?:for me\s+)?(?:of\s+)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Generated image";
  const title = cleaned.length > 64 ? `${cleaned.slice(0, 64).trim()}…` : cleaned;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function normalizeMimeType(value: unknown): GeneratedImagePayload["mimeType"] | null {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") return value;
  return null;
}

function findImageBlock(value: unknown, depth = 0): ImageBlock | null {
  if (!value || depth > 9) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageBlock(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const rawData = typeof record.data === "string" ? record.data : typeof record.bytes === "string" ? record.bytes : null;
  const mimeType = normalizeMimeType(record.mime_type ?? record.mimeType ?? record.content_type ?? record.contentType);
  if (rawData && rawData.length > 100 && mimeType) return { data: rawData, mimeType };

  const priorityKeys = ["output_image", "outputImage", "image", "outputs", "output", "steps", "content", "parts"];
  for (const key of priorityKeys) {
    if (!(key in record)) continue;
    const found = findImageBlock(record[key], depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findImageBlock(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function timedSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const parentAbort = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener("abort", parentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Image generation timed out.")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", parentAbort);
    }
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function generateWithGemini(options: {
  prompt: string;
  attachments: ImageAttachment[];
  dimensions: ImageDimensions;
  abortSignal: AbortSignal;
}): Promise<ImageBlock> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("Gemini image generation is unavailable.");
  const model = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";
  const input: Array<Record<string, string>> = [{ type: "text", text: polishedPrompt(options.prompt) }];
  for (const attachment of options.attachments.slice(0, 6)) {
    input.push({ type: "image", mime_type: attachment.mimeType, data: attachment.data });
  }

  const timed = timedSignal(options.abortSignal, 32_000);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input,
        response_format: {
          type: "image",
          mime_type: "image/png",
          aspect_ratio: options.dimensions.aspectRatio,
          image_size: "1K"
        }
      }),
      signal: timed.signal,
      cache: "no-store"
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body === "object" ? JSON.stringify(body).slice(0, 700) : response.statusText;
      throw new Error(`Gemini image request failed (${response.status}): ${detail}`);
    }
    const block = findImageBlock(body);
    if (!block) throw new Error("Gemini returned no raster image.");
    return block;
  } finally {
    timed.dispose();
  }
}

async function generateWithHuggingFace(options: {
  prompt: string;
  dimensions: ImageDimensions;
  abortSignal: AbortSignal;
}): Promise<ImageBlock> {
  const token = huggingFaceToken();
  if (!token) throw new Error("Hugging Face image generation is unavailable.");
  const model = process.env.HF_IMAGE_MODEL?.trim() || "black-forest-labs/FLUX.1-schnell";
  const encodedModel = model.split("/").map(encodeURIComponent).join("/");
  const timed = timedSignal(options.abortSignal, 32_000);
  try {
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodedModel}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: polishedPrompt(options.prompt),
        parameters: {
          width: options.dimensions.width,
          height: options.dimensions.height,
          num_inference_steps: 4
        }
      }),
      signal: timed.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 700);
      throw new Error(`Hugging Face image request failed (${response.status}): ${detail || response.statusText}`);
    }
    const mimeType = normalizeMimeType(response.headers.get("content-type")?.split(";")[0]);
    if (!mimeType) throw new Error("Hugging Face returned an unsupported image format.");
    const data = arrayBufferToBase64(await response.arrayBuffer());
    if (data.length < 100) throw new Error("Hugging Face returned an empty image.");
    return { data, mimeType };
  } finally {
    timed.dispose();
  }
}

export async function generateNaviImage(options: {
  prompt: string;
  attachments?: ImageAttachment[];
  abortSignal: AbortSignal;
}): Promise<GeneratedImagePayload> {
  const dimensions = inferDimensions(options.prompt);
  const failures: string[] = [];
  let block: ImageBlock | null = null;

  if (geminiApiKey()) {
    try {
      block = await generateWithGemini({
        prompt: options.prompt,
        attachments: options.attachments ?? [],
        dimensions,
        abortSignal: options.abortSignal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error("Navi Gemini image generation failed:", error);
    }
  }

  if (!block && huggingFaceToken() && !(options.attachments?.length)) {
    try {
      block = await generateWithHuggingFace({
        prompt: options.prompt,
        dimensions,
        abortSignal: options.abortSignal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error("Navi Hugging Face image generation failed:", error);
    }
  }

  if (!block) {
    if (options.attachments?.length && !geminiApiKey()) {
      throw new Error("Image editing requires the configured Gemini image provider.");
    }
    throw new Error(failures.length
      ? "The real image providers could not complete this request. Try again after checking provider quota."
      : "No real image-generation provider is configured.");
  }

  return {
    id: `image-${crypto.randomUUID()}`,
    title: imageTitle(options.prompt),
    alt: options.prompt.trim().slice(0, 300) || "Image generated by Navi",
    mimeType: block.mimeType,
    data: block.data,
    prompt: options.prompt.trim(),
    width: dimensions.width,
    height: dimensions.height
  };
}
