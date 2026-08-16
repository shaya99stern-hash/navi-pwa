import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { PROVIDERS, providerApiKey } from "@/lib/ai/provider-registry";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Transcription for one segment of speech.
 *
 * Two earlier shapes are worth knowing about, because the current one is
 * defined by what went wrong with them.
 *
 * The first was `webkitSpeechRecognition` in the browser, which in an
 * installed iOS PWA is frequently absent with no error and no event, plays a
 * system chime the page cannot suppress, and stops in ways nothing can
 * observe.
 *
 * The second recorded a whole utterance with MediaRecorder and posted the
 * container the browser happened to produce — WebM on Chrome, MP4 on Safari,
 * Ogg on Firefox. Most of the code below existed to survive that: a raw-bytes
 * call that rejected WebM outright, a multipart call that inferred the
 * container from a filename, and a list of formats to guess between. "That
 * audio format was rejected" was the most common way dictation failed, and it
 * reached the user as a broken microphone.
 *
 * Now the client sends 16 kHz 16-bit mono WAV that it writes itself, one
 * request per segment of speech, while the person is still talking. Nothing
 * about the format is negotiated, the bodies are small and uniform, and the
 * fallbacks that remain are about *which model* will answer rather than about
 * what it will accept.
 *
 * Whisper runs on the Hugging Face inference API, which is the token this app
 * already uses for image and audio generation, so this costs no new
 * credential and stays on a free tier.
 */

/**
 * Below the platform's own ceiling, deliberately.
 *
 * This was 8 MB, which is larger than the request body Vercel will accept —
 * roughly 4.5 MB, and 4 MB on the edge runtime, enforced at the edge before
 * any handler runs. A body between those two numbers was refused by the
 * platform, so the 413 written here could never be the thing that rendered:
 * the browser saw an opaque failure and the composer looked like it had hung.
 * A limit above the platform's is not a limit, it is a comment.
 *
 * Segments are capped at fourteen seconds, which at 32 kB a second is under
 * half a megabyte, so in practice nothing comes close. This is the second of
 * two guards rather than the only one — but it still has to sit under the
 * platform number to ever be reachable.
 */
const MAX_AUDIO_BYTES = 3_500_000;

/**
 * A segment is seconds of audio, not minutes.
 *
 * The old ceiling was 45 seconds because a request could carry a whole
 * recording. Now the longest body is fourteen seconds of speech, which a
 * warm model returns in one or two — so a request still running after twenty
 * is not slow, it is stuck, and failing fast lets the retry happen while the
 * person is still talking rather than after they have stopped.
 */
const TIMEOUT_MS = 20_000;

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
    return NextResponse.json({ error: "That stretch of audio is too long to send at once." }, { status: 413 });
  }

  /* WAV unless told otherwise, because that is what the recorder writes.
     Codec parameters are still stripped: `audio/webm; codecs=opus` is rejected
     by name even where the container itself would be read, so the parameter
     alone can be the whole failure — and this route still answers older
     clients running from a cached service worker. */
  const rawContentType = request.headers.get("content-type") || "audio/wav";
  const contentType = rawContentType.split(";")[0].trim() || "audio/wav";

  /* The dictation language the user chose.
   *
   * Voice mode has offered a language picker all along and nothing ever sent
   * it — a control that changed a stored preference and nothing else. Whisper
   * detects the language on its own, but detection is what fails on a short
   * clip or a bilingual speaker, which is exactly the person who went looking
   * for the setting. Sent as a bare subtag because that is what the API takes:
   * `he`, not `he-IL`.
   *
   * "auto" means no hint, which is the correct absence rather than a default
   * of English. */
  const requested = (new URL(request.url).searchParams.get("language") ?? "").trim();
  const language = /^[a-z]{2}(-[A-Za-z0-9]+)*$/i.test(requested) ? requested.split("-")[0].toLowerCase() : "";
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
    type.includes("wav") ? "wav"
      : type.includes("mp4") ? "m4a"
        : type.includes("mpeg") ? "mp3"
          : type.includes("ogg") ? "ogg"
            : type.includes("webm") ? "webm"
              : "wav";

  async function viaOpenAiCompatible(model: string): Promise<{ text?: string; failure?: string }> {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `recording.${extensionFor(contentType)}`);
    form.append("model", model);
    if (language) form.append("language", language);
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
      if (attempt.text) return NextResponse.json({ text: attempt.text.trim(), model, language: language || "auto" }, { headers: { "Cache-Control": "no-store" } });
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

    console.error("Navi Soul transcription failed:", failures.join(" | "));
    /* Short enough to read at a glance, because the composer footer is two
       lines and the raw provider body wrapped into a wall of text that pushed
       the whole interface around. The full reason still travels in `detail`
       and reaches the console, which is where diagnosis belongs. */
    const summary = /not supported/i.test(failures.join(" "))
      /* Kept as a distinct message, but it no longer means what it used to.
         The client writes plain 16 kHz WAV, so this is a model that will not
         take audio at all rather than a container to be guessed at again —
         and telling someone to retry would be telling them to wait for
         something that is not going to change. */
      ? "The transcription model would not accept audio. Check NAVI_TRANSCRIBE_MODEL."
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
