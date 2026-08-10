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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    /* The router host, matching image and audio generation. The legacy
       api-inference.huggingface.co host is retired and answers 404, which
       would have made every transcription fail while looking like a bad
       recording. Model ids contain a slash, so each segment is encoded. */
    const encodedModel = transcriptionModel().split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodedModel}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": request.headers.get("content-type") || "audio/webm"
      },
      body: audio,
      signal: controller.signal
    });

    if (response.status === 503) {
      /* A cold model on the free tier. Worth saying, because it succeeds on a
         retry a few seconds later and "failed" would send the user away. */
      return NextResponse.json({ error: "The transcription model is warming up. Try again in a few seconds." }, { status: 503 });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("NaviSoul transcription failed:", response.status, detail.slice(0, 400));
      return NextResponse.json({ error: `Transcription failed (${response.status}).` }, { status: 502 });
    }

    const data = (await response.json()) as { text?: string; error?: string };
    if (typeof data.text !== "string") {
      return NextResponse.json({ error: data.error || "Transcription returned nothing." }, { status: 502 });
    }
    return NextResponse.json({ text: data.text.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      error: aborted ? "Transcription timed out." : "Transcription could not be reached."
    }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
