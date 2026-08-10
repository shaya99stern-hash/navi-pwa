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

  const contentType = request.headers.get("content-type") || "audio/webm";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    /* The real reason reaches the user. A bare "(502)" is what made this
       impossible to diagnose from the outside for three rounds. */
    return NextResponse.json({
      error: `Transcription failed. ${failures[0] ?? "No model answered."}`,
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
