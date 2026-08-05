"use client";

/**
 * Picks the best voice the device actually has.
 *
 * Left to itself the browser hands back the default system voice, which on iOS
 * is the old compact one and is the fastest tell that this is not a native app.
 * Every Apple device also ships far better "enhanced"/"premium" voices, and
 * other platforms ship natural-sounding network voices; both are already
 * installed and simply have to be asked for by name.
 */
const PREFERRED = [
  /\bpremium\b/i,
  /\benhanced\b/i,
  /\bnatural\b/i,
  /\bsiri\b/i,
  /\bgoogle\b/i
];

/** Compact iOS voices and novelty voices are the ones to avoid. */
const AVOID = /\bcompact\b|\beloquence\b|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox/i;

function score(voice: SpeechSynthesisVoice): number {
  if (AVOID.test(voice.name)) return -1;
  let value = 0;
  PREFERRED.forEach((pattern, index) => {
    if (pattern.test(voice.name)) value += PREFERRED.length - index;
  });
  // A local voice cannot stall mid-sentence waiting on the network.
  if (voice.localService) value += 1;
  if (voice.default) value += 0.5;
  return value;
}

export function pickVoice(language: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const tag = language.toLowerCase();
  const base = tag.split("-")[0];
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === tag);
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
  const candidates = exact.length ? exact : sameLanguage.length ? sameLanguage : voices;

  const ranked = candidates
    .map((voice) => ({ voice, value: score(voice) }))
    .filter((entry) => entry.value >= 0)
    .sort((a, b) => b.value - a.value);
  return ranked[0]?.voice ?? candidates[0] ?? null;
}

/**
 * The voice list is populated asynchronously and is usually empty on first
 * call, which is why naive implementations always get the default voice.
 */
export function whenVoicesReady(run: () => void): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  if (window.speechSynthesis.getVoices().length) {
    run();
    return () => {};
  }
  const handler = () => run();
  window.speechSynthesis.addEventListener("voiceschanged", handler, { once: true });
  return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
}

export function speak(text: string, language: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voice = pickVoice(language);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  // Slightly under the default, which reads as hurried for long answers.
  utterance.rate = 0.98;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

/* ------------------------------------------------------------------------
 * Listening — the other half of voice, and until now the duplicated half.
 *
 * There were two independent recognisers: the composer's press-and-hold mic
 * and the voice sheet. They had drifted apart in ways neither file could
 * reveal on its own.
 *
 *  - The sheet honoured the voice-language preference; the composer used
 *    `navigator.language`. Choosing Hebrew in Settings changed one surface and
 *    silently not the other.
 *  - The sheet told a user whose microphone was blocked where to unblock it.
 *    The composer said "Try again" — a retry that cannot succeed until a
 *    permission changes somewhere the page cannot reach.
 *  - The composer appended on every result event without checking `isFinal`,
 *    so interim words landed in the draft and landed again once finalised.
 *
 * Each of those existed because the second copy was never held to what the
 * first had learned. One recogniser, one set of answers.
 * --------------------------------------------------------------------- */

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop?: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
};

function recognitionConstructor(): (new () => RecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as Record<string, new () => RecognitionLike>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function speechRecognitionAvailable(): boolean {
  return Boolean(recognitionConstructor());
}

/**
 * The stored preference resolved to a real BCP-47 tag. `auto` means the
 * device's own language; anything else is an explicit choice, honoured as given.
 */
export function resolveVoiceLanguage(preference: string | undefined): string {
  if (!preference || preference === "auto") {
    return (typeof navigator === "undefined" ? "" : navigator.language) || "en-US";
  }
  return preference;
}

/**
 * What to say, by what actually went wrong.
 *
 * A blocked microphone is not transient and must not be described as though it
 * were. Returns an empty string for a deliberate abort, which is not a failure
 * and deserves no message at all.
 */
export function speechErrorMessage(error: string | undefined): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is off. Turn it on for this app in Settings, or dictate with the keyboard instead.";
    case "no-speech":
      return "Nothing was heard. Try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition could not reach the network. Try again.";
    case "aborted":
      return "";
    default:
      return "Voice input stopped before it could finish. Try again.";
  }
}

export type SpeechSession = {
  /** Finish, keeping what has been recognised. */
  stop: () => void;
  /** Drop it now, keeping nothing further. */
  abort: () => void;
};

export type SpeechOptions = {
  /** The preference, not a resolved tag — resolving is this module's job. */
  language?: string;
  /** A finalised phrase, trimmed. Safe to append. */
  onFinal: (text: string) => void;
  /** Words still being revised. Never append these. */
  onInterim?: (text: string) => void;
  onStart?: () => void;
  /** Runs on every ending, error included, so callers reset in one place. */
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/**
 * Start listening, or return null having already explained why not.
 */
export function startSpeechRecognition(options: SpeechOptions): SpeechSession | null {
  const Recognition = recognitionConstructor();
  if (!Recognition) {
    options.onError?.("Voice input is not supported in this browser.");
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = resolveVoiceLanguage(options.language);
  recognition.interimResults = true;
  /* Single utterance. Continuous listening on iOS holds the microphone open
     across an app switch, which the platform eventually kills without telling
     the page — leaving a lit mic button with nothing behind it. */
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => options.onStart?.();

  recognition.onresult = (event) => {
    let final = "";
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript ?? "";
      if (result?.isFinal) final += text;
      else interim += text;
    }
    if (final.trim()) options.onFinal(final.trim());
    options.onInterim?.(interim.trim());
  };

  recognition.onerror = (event) => {
    const message = speechErrorMessage(event?.error);
    if (message) options.onError?.(message);
  };

  recognition.onend = () => options.onEnd?.();

  recognition.start();
  return {
    stop: () => recognition.stop?.(),
    abort: () => recognition.abort?.()
  };
}
