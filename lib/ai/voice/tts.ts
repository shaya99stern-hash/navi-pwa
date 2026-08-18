/**
 * Premium speech for voice mode, metered so it cannot run away.
 *
 * The app speaks with the browser's own `speechSynthesis` today, which is free,
 * instant, and works offline — and sounds like a phone reading a document. A
 * neural voice is the difference between a tool talking and someone talking,
 * and in a hands-free loop the voice *is* the interface.
 *
 * It is also the first metered thing in this app that is not a model call, and
 * the one with the worst failure shape: a conversational loop generates speech
 * continuously, without anyone pressing send, so an unguarded integration bills
 * for as long as the tab is open. That is why almost all of this file is about
 * the ceiling rather than the audio.
 *
 * Four rules, in the order they are enforced:
 *
 * 1. **No credential, no attempt.** An unconfigured deployment falls back to
 *    on-device speech and behaves exactly as it does today.
 * 2. **Characters are reserved before the call, not billed after it.** Two
 *    concurrent turns that each check a budget and then spend it can both pass
 *    the check; incrementing first means the second one sees the first. The
 *    reservation is an over-count when a request later fails, and over-counting
 *    is the only direction that cannot overspend.
 * 3. **An unreadable ledger is a spent ledger.** Same rule the model spend
 *    ledger already applies: an outage must degrade to the free voice, never to
 *    unlimited billing.
 * 4. **Never throw.** Every failure returns null and the caller speaks
 *    on-device. A voice mode that goes silent because a vendor had a bad minute
 *    is worse than one that sounds ordinary for a sentence.
 *
 * The budget is counted in characters because that is the unit ElevenLabs
 * bills and the unit their free tier is denominated in — converting to dollars
 * would add a made-up exchange rate between this file and the thing it is
 * protecting.
 */

import { getSpendStore } from "../spend";

/** Their free tier, as the default. An operator raises it deliberately. */
const DEFAULT_MONTHLY_CHARS = 10_000;
/**
 * The longest utterance worth sending.
 *
 * Voice mode speaks summaries, not documents — a reply long enough to exceed
 * this is one the spoken track should have shortened rather than narrated, so
 * the cap is a design boundary as much as a cost one.
 */
const MAX_UTTERANCE_CHARS = 800;
/**
 * How long to wait for the first audio byte before giving up on it.
 *
 * Time-to-first-audio is the whole experience in a conversational loop, so the
 * original reasoning was that a premium voice arriving two seconds late is
 * worse than an ordinary one arriving now.
 *
 * That is true, and it left out the case that actually happened: a premium
 * voice arriving *never*. At 2.5 seconds an edge function's cold start plus the
 * vendor's own time-to-first-byte exceeded the deadline often enough that the
 * owner never once heard the voice they had chosen and paid attention to
 * selecting — and because the fallback spends nothing, the ledger stayed at
 * full allowance, which the app then reported as health.
 *
 * Six seconds is still bounded and still falls back rather than hanging, but it
 * is on the other side of the line: a beat of silence before the right voice
 * beats the wrong voice arriving promptly every single time. Tunable, because
 * the right value depends on a region and a network this code cannot see.
 */
const FIRST_BYTE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.NAVI_TTS_FIRST_BYTE_MS);
  return Number.isFinite(raw) && raw >= 500 ? Math.floor(raw) : 6_000;
})();

export type TtsRefusal =
  | "unconfigured"
  | "empty"
  | "too-long"
  | "budget-exhausted"
  | "ledger-unreadable"
  | "provider-failed"
  | "too-slow";

export type TtsResult =
  | { ok: true; audio: ReadableStream<Uint8Array>; contentType: string; charged: number }
  | { ok: false; reason: TtsRefusal; detail: string };

function apiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY?.trim() || undefined;
}

/** The voice to speak in. Without one, every synthesis call refuses. */
function voiceId(): string | undefined {
  return process.env.NAVI_TTS_VOICE_ID?.trim() || undefined;
}

/**
 * Whether premium speech can actually happen — not whether a key exists.
 *
 * This checked the API key alone, while `synthesizeSpeech` refuses without a
 * voice id as well. A deployment with the key and no voice therefore reported
 * "Premium speaking voice: configured" through `inspect_environment` while
 * every single utterance fell back to the device voice.
 *
 * The owner hit exactly that and was told, in the app's own words, that Eleven
 * Labs "is configured and has its full monthly quota available". Both halves
 * were true and the conclusion was wrong: a full quota after weeks of use is
 * evidence that nothing has *ever* been synthesised, which is the opposite of
 * health. The app was holding the proof of its own failure and reporting it as
 * a clean bill.
 */
export function ttsConfigured(): boolean {
  return Boolean(apiKey() && voiceId());
}

/**
 * What is missing, named, when premium speech cannot run.
 *
 * Empty when it can. Separate from the boolean because "not configured" sends
 * someone to look at the wrong variable half the time, and this is the exact
 * question the owner asked and got an invented answer to.
 */
export function ttsMissing(): string[] {
  const missing: string[] = [];
  if (!apiKey()) missing.push("ELEVENLABS_API_KEY");
  if (!voiceId()) missing.push("NAVI_TTS_VOICE_ID");
  return missing;
}

/** Characters allowed per calendar month. Zero disables premium speech. */
export function monthlyCharBudget(): number {
  const raw = Number(process.env.NAVI_TTS_MONTHLY_CHARS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_MONTHLY_CHARS;
}

/** Keyed by month so the allowance resets with the vendor's own billing period. */
export function ttsLedgerKey(now = new Date()): string {
  return `navi:tts:chars:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type TtsUsage = { used: number; budget: number; remaining: number; durable: boolean };

/** What has been spoken this month. An unreadable ledger reads as spent. */
export async function readTtsUsage(): Promise<TtsUsage> {
  const store = getSpendStore();
  const budget = monthlyCharBudget();
  const used = await store.read(ttsLedgerKey()).catch(() => budget);
  return { used, budget, remaining: Math.max(0, budget - used), durable: store.durable };
}

/**
 * The voice, and the settings that make it calm rather than brisk.
 *
 * Stability high enough that delivery does not swing line to line, style low
 * because theatrical reads are the opposite of grounded, and speaker boost off
 * — it adds presence at the cost of the softness this is going for. All three
 * are overridable, because "calm" is a taste and the person listening owns it.
 */
/**
 * The owner's speaking-rate dial, clamped to what the provider accepts.
 *
 * Held to the same range as the device voice so one control means one thing on
 * both engines, rather than a number that changes meaning depending on which
 * voice happens to be answering.
 */
function speed(rate: number | undefined): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1.4, Math.max(0.7, rate as number));
}

function voiceSettings(rate?: number) {
  const num = (name: string, fallback: number): number => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) ? raw : fallback;
  };
  return {
    stability: num("NAVI_TTS_STABILITY", 0.55),
    similarity_boost: num("NAVI_TTS_SIMILARITY", 0.75),
    style: num("NAVI_TTS_STYLE", 0.15),
    use_speaker_boost: process.env.NAVI_TTS_SPEAKER_BOOST === "true",
    speed: speed(rate)
  };
}

/**
 * Speak one utterance, or explain why it will not.
 *
 * Returns a stream rather than a buffer so playback can begin on the first
 * chunk. Waiting for a complete file before any sound is what makes a voice
 * loop feel like a form submission.
 */
export async function synthesizeSpeech(options: {
  text: string;
  /** The owner's speaking-rate dial, as a multiplier of normal. */
  rate?: number;
  signal?: AbortSignal;
}): Promise<TtsResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: "unconfigured", detail: "No ElevenLabs credential is set." };

  const text = options.text.trim();
  if (!text) return { ok: false, reason: "empty", detail: "Nothing to speak." };
  if (text.length > MAX_UTTERANCE_CHARS) {
    return { ok: false, reason: "too-long", detail: `${text.length} characters exceeds the ${MAX_UTTERANCE_CHARS} spoken-utterance limit.` };
  }

  const budget = monthlyCharBudget();
  if (budget <= 0) return { ok: false, reason: "budget-exhausted", detail: "The premium speech budget is set to zero." };

  /* Reserved before the request, so two turns in flight cannot both pass a
     check that only one of them can afford. */
  const store = getSpendStore();
  let used: number;
  try {
    used = await store.add(ttsLedgerKey(), text.length);
  } catch (error) {
    return {
      ok: false,
      reason: "ledger-unreadable",
      detail: `The speech ledger could not be written, so premium speech is treated as spent: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
  if (used > budget) {
    return { ok: false, reason: "budget-exhausted", detail: `${used} of ${budget} characters used this month.` };
  }

  const voice = voiceId();
  if (!voice) return { ok: false, reason: "unconfigured", detail: "NAVI_TTS_VOICE_ID is not set." };

  /* Two aborts, deliberately: the caller's, which cancels the whole turn, and
     ours, which gives up on a slow start without touching the turn. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
  const forward = () => controller.abort();
  options.signal?.addEventListener("abort", forward);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: process.env.NAVI_TTS_MODEL?.trim() || "eleven_turbo_v2_5",
          voice_settings: voiceSettings(options.rate)
        }),
        signal: controller.signal
      }
    );

    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return { ok: false, reason: "provider-failed", detail: `ElevenLabs answered ${response.status}${detail ? ` ${detail}` : ""}` };
    }

    /* Headers are in, so the slow-start deadline has been met. The rest of the
       stream is bounded by the caller's own signal, not by ours — cancelling
       mid-sentence is exactly what this timer must not do. */
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forward);
    return {
      ok: true,
      audio: response.body,
      contentType: response.headers.get("content-type") || "audio/mpeg",
      charged: text.length
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "too-slow" : "provider-failed",
      detail: aborted
        ? `No audio within ${FIRST_BYTE_TIMEOUT_MS}ms; the on-device voice is faster than waiting.`
        : `ElevenLabs could not be reached: ${error instanceof Error ? error.message : "unknown error"}`
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forward);
  }
}

/**
 * Whether a refusal is worth telling the user about.
 *
 * Most are not. Falling back to the on-device voice is a slightly different
 * timbre, not a failure, and narrating it every turn would be worse than the
 * thing it is reporting. A spent budget is the exception: it persists for the
 * rest of the month and the person can act on it.
 */
export function refusalWorthSurfacing(reason: TtsRefusal): boolean {
  return reason === "budget-exhausted";
}
