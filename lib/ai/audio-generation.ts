import { getHuggingFaceToken } from "./providers";

/**
 * Sound generation: music, effects, and speech.
 *
 * Deliberately shaped like the image pipeline rather than as a general
 * "audio" feature, because the two jobs behind it are genuinely different.
 * A three-second UI ding and a spoken sentence want different models, different
 * prompts, and different durations, and a single endpoint that tried to serve
 * both would serve neither well.
 *
 * Everything runs on the Hugging Face router, so no additional credential is
 * needed beyond the token the app already uses.
 */

export type AudioKind = "music" | "effect" | "speech";

export type GeneratedAudioPayload = {
  id: string;
  title: string;
  /** Navi-branded engine name shown on the card, never the raw model id. */
  engine: string;
  kind: AudioKind;
  mimeType: "audio/wav" | "audio/mpeg" | "audio/flac" | "audio/ogg";
  data: string;
  prompt: string;
  /** Seconds, when the engine reports or was asked for a specific length. */
  durationSeconds?: number;
};

type AudioEngine = {
  model: string;
  /** The name the user sees. The raw model id is never surfaced. */
  label: string;
  /** What this engine leads at, in one line, for the picker and the logs. */
  strength: string;
};

/**
 * One engine per job, chosen for what it leads at rather than for variety.
 *
 * MusicGen is the strongest open text-to-music family and handles both scored
 * music and short designed sounds; the stereo-large weights are worth the extra
 * seconds for anything a person will listen to twice. Bark carries speech
 * because it produces natural prosody — the difference between a voice that
 * reads and a voice that speaks — and can do non-verbal sounds inline.
 */
export const AUDIO_ENGINES = {
  music: {
    model: process.env.NAVI_MUSIC_MODEL ?? "facebook/musicgen-stereo-large",
    label: "Navi Sound",
    strength: "scored music with structure and instrumentation"
  },
  /* Short cues want speed and tight control far more than they want richness:
     a ding is over before a large model has finished its first bar. */
  effect: {
    model: process.env.NAVI_EFFECT_MODEL ?? "facebook/musicgen-small",
    label: "Navi Sound",
    strength: "short cues, stings, and interface sounds"
  },
  speech: {
    model: process.env.NAVI_VOICE_MODEL ?? "suno/bark",
    label: "Navi Voice",
    strength: "spoken words with natural prosody"
  }
} satisfies Record<AudioKind, AudioEngine>;

/** Anything longer is a composition, not a generated clip, and times out. */
const MAX_DURATION_SECONDS = 30;
const DEFAULT_MUSIC_SECONDS = 12;
/** A cue that runs long stops being a cue. */
const DEFAULT_EFFECT_SECONDS = 3;
const REQUEST_TIMEOUT_MS = 55_000;

const SPEECH_REQUEST =
  /\b(say|says|saying|speak|read (?:this|it|that|aloud)|out ?loud|voice ?over|voiceover|narrate|narration|pronounce|text[- ]to[- ]speech|tts|in (?:a|your) voice)\b/i;

/* A request to write code that makes a noise is a coding request. Generating
   an actual clip instead of the function would answer a question nobody
   asked, so code phrasing vetoes the audio pipeline outright. */
const CODE_CONTEXT =
  /\b(function|method|class|component|script|snippet|code|api|endpoint|library|package|import|css|html|javascript|typescript|python|react|swift|kotlin|hook|useEffect|npm)\b/i;

/* Short, functional sounds. These are the ones people describe by their job
   ("a ding for when a message arrives") rather than by their music. */
const EFFECT_REQUEST =
  /\b(ding|chime|beep|blip|click|pop|whoosh|swoosh|swish|buzz|buzzer|alert|alarm|notification|ringtone|ring ?tone|sound ?effect|sfx|sting|jingle|cue|bell|tone|earcon|ui sound|button sound|error sound|success sound)\b/i;

const MUSIC_REQUEST =
  /\b(music|song|track|beat|melody|tune|instrumental|soundtrack|score|loop|ambient|lo-?fi|synthwave|orchestral|piano|guitar|drums|bass ?line|riff|theme (?:song|music)|background music|bgm)\b/i;

/** Any request to produce sound at all — the gate before classification. */
const AUDIO_INTENT =
  /\b(generate|create|make|produce|compose|write|record|give me|play|build|design)\b[\s\S]{0,80}\b(sound|audio|music|song|track|beat|melody|tune|jingle|ding|chime|beep|alarm|notification|ringtone|voice ?over|voiceover|narration|sound ?effect|sfx|sting)\b/i;

/**
 * Whether this request is asking Navi to produce sound.
 *
 * Held to an explicit ask on purpose. "What does a theremin sound like" is a
 * question about sound, not a request for a file, and answering it with a
 * generated clip instead of an explanation would be worse than useless.
 */
export function audioGenerationIntent(text: string): boolean {
  if (!text.trim()) return false;
  if (CODE_CONTEXT.test(text)) return false;
  if (AUDIO_INTENT.test(text)) return true;
  // "Say hello in a British accent" is unambiguous without a creation verb.
  return SPEECH_REQUEST.test(text) && /["'“”]|\bsaying\b|\bthat says\b/.test(text);
}

/**
 * Which of the three jobs this is.
 *
 * Order matters. Speech wins over everything because "sing me a song saying
 * happy birthday" is words first; effects beat music because a ding described
 * as "a short musical ding" is still a ding.
 */
export function classifyAudioRequest(text: string): AudioKind {
  if (SPEECH_REQUEST.test(text)) return "speech";
  if (EFFECT_REQUEST.test(text)) return "effect";
  if (MUSIC_REQUEST.test(text)) return "music";
  return "music";
}

/** Pull an explicit length out of the request, when one was given. */
export function requestedDuration(text: string, kind: AudioKind): number {
  const match = /\b(\d{1,2}(?:\.\d)?)\s*(?:-|\s)?\s*(second|sec|s)\b/i.exec(text);
  const asked = match ? Number(match[1]) : NaN;
  const fallback = kind === "effect" ? DEFAULT_EFFECT_SECONDS : DEFAULT_MUSIC_SECONDS;
  if (!Number.isFinite(asked) || asked <= 0) return fallback;
  return Math.min(Math.round(asked), MAX_DURATION_SECONDS);
}

/**
 * Extract the words that should actually be spoken.
 *
 * Without this the model narrates the instruction — asked to "say hello in a
 * calm voice" it reads the whole sentence back, stage directions included.
 */
export function spokenText(text: string): string {
  const quoted = /["'“”]([^"'“”]{2,600})["'“”]/.exec(text);
  if (quoted) return quoted[1].trim();
  const after = /\b(?:say|speak|read|narrate|pronounce)\b\s*(?:that|this|it)?\s*:?\s*(.{2,600})$/is.exec(text);
  if (after) {
    return after[1]
      // Drop a trailing delivery note so it is not read out as content.
      .replace(/\b(?:in|with|using)\s+(?:a|an|your)?\s*[\w\s-]{0,40}\b(?:voice|accent|tone|style)\b.*$/i, "")
      .trim();
  }
  return text.trim().slice(0, 600);
}

/**
 * Turn the request into a prompt the engine responds to.
 *
 * Music models take a description of the music, not an instruction to make it,
 * so the leading "generate me a…" is stripped; leaving it in measurably steers
 * the output toward spoken-word-sounding noise.
 */
export function audioPrompt(text: string, kind: AudioKind): string {
  if (kind === "speech") return spokenText(text);
  const stripped = text
    .replace(/^\s*(?:can you|could you|please|hey|navi)\b[\s,]*/i, "")
    .replace(/^\s*(?:generate|create|make|produce|compose|write|design|build|give me|play)\b\s*(?:me\s+)?(?:a|an|some|the)?\s*/i, "")
    .trim();
  const base = stripped || text.trim();
  if (kind !== "effect") return base;
  /* Cue models drift toward musical phrases unless told the shape of the
     thing: one gesture, clean tail, no groove. */
  return `${base}. Short isolated sound cue, clean attack and decay, no melody loop, no background music.`;
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function normalizeAudioMime(value: string | undefined): GeneratedAudioPayload["mimeType"] | null {
  const type = value?.trim().toLowerCase();
  if (!type) return null;
  if (type.includes("wav")) return "audio/wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio/mpeg";
  if (type.includes("flac")) return "audio/flac";
  if (type.includes("ogg")) return "audio/ogg";
  return null;
}

function timedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const forward = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Audio generation timed out.")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forward);
    }
  };
}

function titleFor(kind: AudioKind, prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  const short = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  if (kind === "speech") return short ? `“${short}”` : "Spoken audio";
  if (kind === "effect") return short || "Sound cue";
  return short || "Generated music";
}

/**
 * Generate a clip.
 *
 * Errors carry the reason rather than a generic failure: an unconfigured token
 * and a model still warming up need different actions from the person reading
 * the message, and collapsing them into "audio failed" hides which it was.
 */
export async function generateNaviAudio(options: {
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<GeneratedAudioPayload> {
  const token = getHuggingFaceToken();
  if (!token) {
    throw new Error("Sound generation needs a Hugging Face token. Add HF_TOKEN in your Vercel project settings, then redeploy.");
  }

  const kind = classifyAudioRequest(options.prompt);
  const engine = AUDIO_ENGINES[kind];
  const prompt = audioPrompt(options.prompt, kind);
  if (!prompt.trim()) throw new Error("There was nothing to generate — describe the sound, or give the words to speak.");
  const duration = kind === "speech" ? undefined : requestedDuration(options.prompt, kind);

  const encodedModel = engine.model.split("/").map(encodeURIComponent).join("/");
  const timed = timedSignal(options.abortSignal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodedModel}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: prompt,
        ...(duration ? { parameters: { duration } } : {})
      }),
      signal: timed.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      /* A cold model is a wait, not a failure, and telling someone to "try
         again shortly" is only useful if it is actually true. */
      if (response.status === 503) {
        throw new Error(`${engine.label} is still starting up. Try again in about a minute.`);
      }
      if (response.status === 404) {
        throw new Error(`${engine.label} is not available on your Hugging Face plan right now.`);
      }
      throw new Error(`${engine.label} could not generate that (${response.status}). ${detail}`.trim());
    }

    const mimeType = normalizeAudioMime(response.headers.get("content-type")?.split(";")[0]) ?? "audio/wav";
    const data = base64FromArrayBuffer(await response.arrayBuffer());
    if (data.length < 100) throw new Error(`${engine.label} returned an empty clip.`);

    return {
      id: `audio-${Date.now().toString(36)}`,
      title: titleFor(kind, kind === "speech" ? prompt : options.prompt),
      engine: engine.label,
      kind,
      mimeType,
      data,
      prompt,
      durationSeconds: duration
    };
  } finally {
    timed.dispose();
  }
}
