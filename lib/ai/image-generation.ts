import type { GeneratedImagePayload } from "./types";
import { validateGeneratedImage } from "./navi-soul/image-preflight";

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
      process.env.HUGGING_FACE_FINE_GRAINED_API,
      process.env.fable_read_Hugging_face,
      process.env.HUGGING_FACE_API_Write,
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

/**
 * Navi-branded image engines.
 *
 * Each underlying model leads at something different, so each gets a Navi name
 * describing what it is for rather than who built it. The raw model id is an
 * implementation detail and is never shown: swapping a model out later should
 * not rename a feature the user has learned.
 */
export const IMAGE_ENGINES = {
  /** Instruction-following and editing: the only engine that can edit at all. */
  navi: {
    name: "Navi Image",
    detail: "Everyday images, and every kind of edit",
    model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image"
  },
  /** Photoreal and editorial detail, for creation from nothing. */
  studio: {
    name: "Navi Image Studio",
    detail: "Photoreal and editorial detail",
    model: process.env.HF_IMAGE_MODEL?.trim() || "black-forest-labs/FLUX.1-schnell"
  },
  /**
   * Words inside the picture. Diffusion models famously garble typography;
   * Qwen-Image reasons about language and layout as part of generation, so it
   * is the one to use for a poster, a sign, a logo, or a label.
   */
  text: {
    name: "Navi Image Text",
    detail: "Readable words inside the image",
    model: process.env.HF_TEXT_IMAGE_MODEL?.trim() || "Qwen/Qwen-Image"
  }
} as const;

/** Asking for words in the picture, rather than words about the picture. */
const WANTS_TEXT_IN_IMAGE = /\b(?:that says|which says|saying|reading|with the (?:words?|text|caption)|poster|flyer|sign|signage|banner|logo|wordmark|label|menu|billboard|certificate|invitation|book cover|album cover|typography|lettering|headline|slogan|meme)\b/i;

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

/**
 * What the request actually is, which decides the entire prompt.
 *
 * Creating and editing want opposite instructions. "Compose a finished image
 * with intentional lighting and strong detail" is right for a blank canvas and
 * catastrophic for an edit: it tells the model to re-render the picture it was
 * handed, which is exactly how a document comes back with different numbers
 * and a person comes back with a different face.
 */
type ImageRequest = {
  mode: "create" | "edit";
  /** The image carries text, numbers, or data that must survive verbatim. */
  preserveText: boolean;
  /** The image contains a person whose identity must survive. */
  preserveIdentity: boolean;
  /** Things the user explicitly said not to touch. */
  constraints: string[];
};

const TEXT_BEARING = /\b(document|paper|form|receipt|invoice|statement|spreadsheet|table|chart|label|sign|menu|page|letter|contract|report|ticket|card|screenshot|text|word|words|number|numbers|digit|digits|figure|figures|amount|amounts|price|date|total|handwriting|handwritten|caption|heading|title)\b/i;

/* Only unambiguous person words. Possessives like "my" and "her" are far too
   common — "my paper" would otherwise pull face-preservation rules into a
   document edit, which is noise at best and misdirection at worst. */
const PERSON_BEARING = /\b(person|people|face|faces|facial|portrait|selfie|headshot|man|men|woman|women|boy|girl|child|children|kid|baby|guy|lady|friend|family|mother|father|mom|mum|dad|sister|brother|son|daughter|wife|husband|hair|skin|smile|eyes)\b/i;

/* Ways people say "leave this alone". Each captures the thing to protect. */
const CONSTRAINT_PATTERNS: RegExp[] = [
  /\b(?:do\s?n[o']?t|don't|never|avoid)\s+(?:change|alter|modify|touch|edit|move|remove|replace|adjust|fix)\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+|any\s+)?([^.,;!?\n]{2,80})/gi,
  /\bkeep\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+)?([^.,;!?\n]{2,80}?)\s+(?:exactly\s+)?(?:the\s+same|unchanged|as\s+(?:is|they\s+are|it\s+is)|identical|intact)/gi,
  /\b(?:leave|keep)\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+)?([^.,;!?\n]{2,80}?)\s+(?:alone|untouched|intact|be)/gi,
  /\bwithout\s+(?:changing|altering|modifying|touching|editing|removing)\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+|any\s+)?([^.,;!?\n]{2,80})/gi,
  /\b(?:preserve|retain|maintain)\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+)?([^.,;!?\n]{2,80})/gi
];

/** "Only change the date" is also a preservation instruction about everything else. */
const ONLY_CHANGE = /\b(?:only|just)\s+(?:change|edit|modify|update|replace|fix|adjust)\s+(?:the\s+|my\s+)?([^.,;!?\n]{2,80})/i;

function extractConstraints(prompt: string): string[] {
  const found = new Set<string>();
  for (const pattern of CONSTRAINT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of prompt.matchAll(pattern)) {
      const phrase = match[1]?.replace(/\s+/g, " ").trim();
      if (phrase && phrase.length > 1) found.add(phrase.toLowerCase());
    }
  }
  return [...found].slice(0, 8);
}

export function classifyImageRequest(prompt: string, hasAttachments: boolean): ImageRequest {
  const mode = hasAttachments ? "edit" : "create";
  return {
    mode,
    preserveText: mode === "edit" && TEXT_BEARING.test(prompt),
    preserveIdentity: mode === "edit" && PERSON_BEARING.test(prompt),
    constraints: mode === "edit" ? extractConstraints(prompt) : []
  };
}

/** Instructions for a blank canvas: compose something finished. */
function creationPrompt(prompt: string): string {
  return [
    prompt.trim(),
    "Create a complete, professionally composed raster image with coherent anatomy, intentional lighting, strong detail, and a finished visual style.",
    "Do not output SVG, clip art, diagrams, UI chrome, captions, borders, or watermarks unless explicitly requested."
  ].join("\n\n");
}

/**
 * Instructions for an edit: a preservation contract.
 *
 * The default failure of an image model handed a picture is to redraw it in
 * its own style and call that an edit. Everything here exists to make the
 * untouched parts of the image the priority and the requested change the
 * exception.
 */
function editPrompt(prompt: string, request: ImageRequest): string {
  const onlyChange = ONLY_CHANGE.exec(prompt)?.[1]?.trim();

  const parts = [
    "Edit the image that was provided. Return that same image with only the requested change applied to it.",
    `Requested change:\n${prompt.trim()}`,
    [
      "Everything else in the image must be preserved exactly as it appears in the source:",
      "- Do not redraw, re-render, restyle, repaint, or reinterpret the image.",
      "- Do not crop, rotate, rescale, reframe, or change the composition, dimensions, or aspect ratio.",
      "- Do not adjust colour, lighting, contrast, sharpness, or background unless that is what was asked for.",
      "- Do not add, remove, or move any element that the request did not mention.",
      "- Do not \"improve\", clean up, or beautify anything you were not asked to change.",
      "Treat every pixel outside the requested change as something to copy, not something to recreate."
    ].join("\n")
  ];

  if (onlyChange) {
    parts.push(`The request limits the edit to: ${onlyChange}. Nothing else in the image may differ from the source in any way.`);
  }

  if (request.constraints.length) {
    parts.push([
      "The user explicitly named things that must not change. These are absolute:",
      ...request.constraints.map((item) => `- ${item}`),
      "If applying the requested change would alter any of these, leave that region untouched and say so rather than changing it."
    ].join("\n"));
  }

  if (request.preserveText) {
    parts.push([
      "This image contains text or numeric data. Text fidelity outranks visual quality here.",
      "- Every character, word, number, digit, date, amount, code, and symbol that was not explicitly named for change must appear in the output exactly as in the source, character for character.",
      "- Do not re-typeset, re-align, re-font, re-space, or re-flow any text.",
      "- Do not correct spelling, grammar, formatting, arithmetic, or apparent mistakes. A value that looks wrong is still the value.",
      "- Do not invent, complete, or fill in text that is cut off, blurred, or illegible in the source. Reproduce it as it appears.",
      "- Keep the original resolution and sharpness so the text stays legible."
    ].join("\n"));
  }

  if (request.preserveIdentity) {
    parts.push([
      "This image contains a real person. Their identity must survive the edit intact.",
      "- The face must remain the same face: identical facial structure, proportions, features, skin tone, complexion, hair, eye colour, expression, and apparent age.",
      "- Do not beautify, smooth, slim, retouch, de-age, age, or idealise the person in any way.",
      "- Do not alter body shape, posture, or hands.",
      "- The person in the output must be unmistakably recognisable as the same individual to someone who knows them.",
      "If the requested change cannot be made without altering the face, make the change only in the surrounding area and leave the face untouched."
    ].join("\n"));
  }

  return parts.join("\n\n");
}

function polishedPrompt(prompt: string, request?: ImageRequest): string {
  return request?.mode === "edit" ? editPrompt(prompt, request) : creationPrompt(prompt);
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
  request: ImageRequest;
  abortSignal: AbortSignal;
}): Promise<ImageBlock> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("Gemini image generation is unavailable.");
  const model = IMAGE_ENGINES.navi.model;
  const editing = options.request.mode === "edit";
  const input: Array<Record<string, string>> = [{ type: "text", text: polishedPrompt(options.prompt, options.request) }];
  for (const attachment of options.attachments.slice(0, 6)) {
    input.push({ type: "image", mime_type: attachment.mimeType, data: attachment.data });
  }

  /* An edit must inherit the source geometry. Sending an aspect ratio asks the
     model to re-frame, which crops the picture the user wanted preserved —
     and the word "person" in "don't change the person's face" was enough to
     force a portrait crop on a landscape document. */
  const responseFormat: Record<string, string> = { type: "image" };
  if (editing) {
    // Lossless output and more pixels, so small text survives the round trip.
    responseFormat.mime_type = "image/png";
    if (options.request.preserveText) responseFormat.image_size = "2K";
  } else {
    responseFormat.mime_type = "image/jpeg";
    responseFormat.aspect_ratio = options.dimensions.aspectRatio;
    responseFormat.image_size = "1K";
  }

  const timed = timedSignal(options.abortSignal, editing ? 45_000 : 32_000);
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
        response_format: responseFormat
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
  model: string;
  dimensions: ImageDimensions;
  abortSignal: AbortSignal;
}): Promise<ImageBlock> {
  const token = huggingFaceToken();
  if (!token) throw new Error("Hugging Face image generation is unavailable.");
  const model = options.model;
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
          num_inference_steps: 28
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
  const attachments = options.attachments ?? [];
  const request = classifyImageRequest(options.prompt, attachments.length > 0);
  const dimensions = inferDimensions(options.prompt);
  const failures: string[] = [];
  let block: ImageBlock | null = null;
  let engine: string = IMAGE_ENGINES.navi.name;

  if (geminiApiKey()) {
    try {
      const candidate = await generateWithGemini({
        prompt: options.prompt,
        attachments,
        dimensions,
        request,
        abortSignal: options.abortSignal
      });
      const checked = validateGeneratedImage(candidate);
      if (!checked.ok) throw new Error(checked.error);
      block = { data: candidate.data, mimeType: checked.mimeType };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error("Navi Gemini image generation failed:", error);
    }
  }

  if (!block && huggingFaceToken() && !(options.attachments?.length)) {
    try {
      const chosen = WANTS_TEXT_IN_IMAGE.test(options.prompt) ? IMAGE_ENGINES.text : IMAGE_ENGINES.studio;
      const candidate = await generateWithHuggingFace({
        prompt: options.prompt,
        model: chosen.model,
        dimensions,
        abortSignal: options.abortSignal
      });
      const checked = validateGeneratedImage(candidate);
      if (!checked.ok) throw new Error(checked.error);
      block = { data: candidate.data, mimeType: checked.mimeType };
      engine = chosen.name;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error("Navi Hugging Face image generation failed:", error);
    }
  }

  if (!block) {
    /* Editing never silently becomes generating. Returning a fresh invented
       picture in place of the user's own image is worse than failing, because
       it looks like it worked. */
    if (request.mode === "edit") {
      throw new Error(geminiApiKey()
        ? "Navi Soul could not edit that image. It will not generate a different picture in its place — try again, or describe the change more specifically."
        : "Editing an image needs the Gemini image provider, which is not configured on this deployment.");
    }
    throw new Error(failures.length
      ? "The real image providers could not complete this request. Try again after checking provider quota."
      : "No real image-generation provider is configured.");
  }

  return {
    id: `image-${crypto.randomUUID()}`,
    title: imageTitle(options.prompt),
    engine,
    alt: options.prompt.trim().slice(0, 300) || "Image generated by Navi Soul",
    mimeType: block.mimeType,
    data: block.data,
    prompt: options.prompt.trim(),
    // An edit keeps the source geometry, so reporting inferred dimensions
    // would mislabel it and stretch the card it renders in.
    ...(request.mode === "edit" ? {} : { width: dimensions.width, height: dimensions.height })
  };
}
