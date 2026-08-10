import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { PROVIDERS, providerApiKey } from "@/lib/ai/provider-registry";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Transcription, so dictation stops depending on the browser's speech API.
 *
 * `webkitSpeechRecognition` is why the microphone "doesn't work at all": it is
 * absent or unreliable in an installed iOS PWA, it plays a system chime the
 * page cannot suppress, and it silently stops in ways nothing can observe.
 * Recording audio and transcribing it here avoids all three — the recorder is
 * plain MediaRecorder, which works everywhere, makes no sound, and gives the
 * app a real waveform to draw.
 *
 * Whisper runs on the Hugging Face inference API, which is the token this app
 * already uses for image and audio generation, so this costs no new
 * credential and stays on a free tier.
 */

/** Roughly two minutes of Opus. Longer than anyone dictates into a composer. */
const MAX_AUDIO_BYTES = 8_000_000;
const TIMEOUT_MS = 45_000;

function transcriptionModel(): string {
  return process.env.NAVI_TRANSCRIBE_MODEL?.trim() || "openai/whisper-large-v3-turbo";
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const token = providerApiKey(PROVIDERS.huggingface);
  if (!token) {
    return NextResponse.json({
      error: "Transcription is not configured. Add HF_TOKEN in Vercel to enable voice input."
    }, { status: 503 });
  }

  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return NextResponse.json({ error: "No audio was received." }, { status: 400 });
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "That recording is too long. Keep it under about two minutes." }, { status: 413 });
  }

  /* Strip codec parameters. `audio/webm; codecs=opus` is rejected by name
     even where the container itself would be read, so the parameter alone can
     be the whole failure. */
  const rawContentType = request.headers.get("content-type") || "audio/webm";
  const contentType = rawContentType.split(";")[0].trim() || "audio/webm";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /**
   * The OpenAI-compatible transcription endpoint, tried first.
   *
   * It takes multipart form-data with a filename, so the container is
   * inferred from the file rather than from a header the service matches
   * against a fixed list. That is what makes it tolerate the formats a
   * browser actually records — the raw-bytes path rejected WebM outright,
   * which is why every recording failed at the final step.
   */
  const extensionFor = (type: string) =>
    type.includes("mp4") ? "m4a"
      : type.includes("mpeg") ? "mp3"
        : type.includes("ogg") ? "ogg"
          : type.includes("wav") ? "wav"
            : "webm";

  async function viaOpenAiCompatible(model: string): Promise<{ text?: string; failure?: string }> {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `recording.${extensionFor(contentType)}`);
    form.append("model", model);
    try {
      const response = await fetch("https://router.huggingface.co/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal
      });
      if (!response.ok) {
        return { failure: `${model} (multipart): ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}` };
      }
      const data = (await response.json().catch(() => null)) as { text?: string } | null;
      return typeof data?.text === "string" ? { text: data.text } : { failure: `${model} (multipart): no text` };
    } catch (error) {
      return { failure: `${model} (multipart): ${error instanceof Error ? error.message : "unreachable"}` };
    }
  }

  /**
   * Models to try, in order.
   *
   * Which speech models a free Hugging Face account can reach changes, and a
   * single hard-coded id turns "your account cannot use that one" into "the
   * microphone is broken". Trying a short list costs one extra round trip in
   * the bad case and removes a whole class of dead end.
   */
  const models = [
    transcriptionModel(),
    "openai/whisper-large-v3",
    "openai/whisper-small"
  ].filter((model, index, all) => all.indexOf(model) === index);

  try {
    /* Every failure is recorded rather than collapsed, because the useful
       question after "it still does not work" is *which* step refused and
       what it said — and that answer has been unavailable three times now. */
    const failures: string[] = [];

    /* Multipart first, for every candidate: it is the path that tolerates the
       containers browsers actually produce. The raw-bytes calls below remain
       as a fallback for a provider that only speaks that dialect. */
    for (const model of models) {
      const attempt = await viaOpenAiCompatible(model);
      if (attempt.text) return NextResponse.json({ text: attempt.text.trim(), model }, { headers: { "Cache-Control": "no-store" } });
      if (attempt.failure) failures.push(attempt.failure);
    }

    for (const model of models) {
      const encodedModel = model.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodedModel}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: audio,
        signal: controller.signal
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (typeof data?.text === "string") {
          return NextResponse.json({ text: data.text.trim(), model }, { headers: { "Cache-Control": "no-store" } });
        }
        failures.push(`${model}: answered without text${data?.error ? ` (${data.error})` : ""}`);
        continue;
      }

      const detail = (await response.text().catch(() => "")).slice(0, 300);
      failures.push(`${model}: ${response.status} ${detail || response.statusText}`);

      /* A warming model succeeds on a retry, so it is worth saying rather than
         burning the remaining candidates on the same cold start. */
      if (response.status === 503) {
        return NextResponse.json({
          error: "The transcription model is warming up. Try again in a few seconds.",
          detail: failures.join(" | ")
        }, { status: 503 });
      }
      /* A rejected token will reject every model, so stop rather than repeat. */
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json({
          error: "Hugging Face rejected the token. It needs Inference permission — recreate it with 'Make calls to Inference Providers' enabled.",
          detail: failures.join(" | ")
        }, { status: 502 });
      }
    }

    console.error("NaviSoul transcription failed:", failures.join(" | "));
    /* Short enough to read at a glance, because the composer footer is two
       lines and the raw provider body wrapped into a wall of text that pushed
       the whole interface around. The full reason still travels in `detail`
       and reaches the console, which is where diagnosis belongs. */
    const summary = /not supported/i.test(failures.join(" "))
      ? "That audio format was rejected. Try again — a different format will be used."
      : "No transcription model would answer. The detail is in the console.";
    return NextResponse.json({
      error: summary,
      detail: failures.join(" | "),
      sentAs: contentType
    }, { status: 502 });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      error: aborted ? "Transcription timed out." : "Transcription could not be reached."
    }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
