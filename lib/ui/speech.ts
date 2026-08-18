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

/**
 * One audio element for every premium utterance, and the reason it is shared.
 *
 * iOS grants playback to an element, not to the page. A `new Audio()` per
 * utterance is unlocked only if the tap that created it is still on the stack —
 * true for the read-aloud button, false for every turn of a hands-free
 * conversation, where the audio is a consequence of speaking rather than of
 * touching anything. Reusing one element that was played once inside a real
 * gesture keeps that grant for the rest of the session, which is what makes
 * turn two audible.
 */
let sharedAudio: HTMLAudioElement | null = null;

function audioElement(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

/**
 * Fifteen milliseconds of silence, played to spend a user gesture on the
 * element that will later speak.
 *
 * A zero-sample file is rejected as malformed by some engines, so this is a
 * real, inaudible clip rather than an empty header.
 */
const SILENCE = "data:audio/wav;base64,UklGRgQCAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YeABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/**
 * Called from the tap that starts a spoken conversation.
 *
 * Never awaited and never reported: a browser that refuses this is one where
 * the device voice takes over, which is a working configuration rather than a
 * fault.
 */
export function primeSpeech(): void {
  if (typeof window === "undefined") return;
  const audio = audioElement();
  audio.muted = true;
  audio.src = SILENCE;
  void audio.play()
    .then(() => { audio.pause(); audio.currentTime = 0; })
    .catch(() => {})
    .finally(() => { audio.muted = false; });
}

/** A voice that is speaking, and the one thing a caller needs to do to it. */
export type SpokenHandle = {
  stop: () => void;
  /** Resolves when the audio finishes, is stopped, or fails. Never rejects. */
  done: Promise<void>;
};

/**
 * Speak with the premium voice when it is available, the device's when it is not.
 *
 * The fallback is the *expected* path, not the sad one. A deployment with no
 * ElevenLabs credential takes it on every utterance and is working correctly,
 * so nothing here treats it as an error or tells anyone about it — the server
 * answers 204 to mean "use the local voice" precisely so this cannot be
 * mistaken for a fault.
 *
 * Must be called from a user gesture the first time on iOS, which is what
 * unlocks audio playback for the rest of the session. Every current caller is a
 * button, and the hands-free loop inherits the unlock from the tap that starts
 * it.
 *
 * The audio is collected before it plays rather than played as it arrives.
 * Chunked playback needs MediaSource and a codec the browser will accept
 * mid-stream, which is a real piece of work; at the 800-character ceiling an
 * utterance is a few seconds of speech, and the server already abandons a
 * request that has not started within 2.5 seconds. So the wait is bounded and
 * short, and this stays honest about being a buffer rather than a stream.
 */
export async function speakBest(text: string, language: string): Promise<SpokenHandle> {
  /**
   * The device voice, wrapped so `done` means the same thing it does for
   * premium audio: this utterance has stopped.
   *
   * `speechSynthesis` has no end event that fires reliably across engines, so
   * it is polled — but the polling lives here rather than in the caller. A
   * component that has to know which engine is speaking in order to know when
   * it stopped is a component that will get it wrong, and the first version of
   * this had exactly that bug: a poll watching `speechSynthesis.speaking`,
   * which premium audio leaves false for its entire duration, racing a promise
   * that resolved immediately.
   */
  const local = (): SpokenHandle => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return { stop: () => {}, done: Promise.resolve() };
    }
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => { settle = resolve; });
    let poll = 0;
    const finish = () => { window.clearInterval(poll); settle(); };

    whenVoicesReady(() => {
      speak(text, language);
      /* Started after the utterance is queued, and tolerant of the gap before
         `speaking` flips true — a poll that fires in that window would end the
         turn before a word was said. */
      let started = false;
      poll = window.setInterval(() => {
        if (window.speechSynthesis.speaking) { started = true; return; }
        if (started) finish();
      }, 300);
    });

    return { stop: () => { window.speechSynthesis.cancel(); finish(); }, done };
  };

  if (typeof window === "undefined") return local();

  try {
    const response = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    /* 204 is the server saying "use the local voice" — unconfigured, over
       budget, or slower than waiting for it was worth. */
    if (response.status !== 200 || !response.body) return local();

    const blob = await response.blob();
    if (!blob.size) return local();

    const url = URL.createObjectURL(blob);
    /* The shared element, so a conversation's second reply plays on the grant
       its first tap earned. Each utterance gets its own listeners and takes
       them away again on the way out — a reused element that accumulates them
       would settle every previous utterance's promise on this one's end. */
    const audio = audioElement();
    audio.pause();
    audio.src = url;
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => { settle = resolve; });
    const stopListening = new AbortController();
    const finish = () => {
      stopListening.abort();
      URL.revokeObjectURL(url);
      settle();
    };
    audio.addEventListener("ended", finish, { once: true, signal: stopListening.signal });
    audio.addEventListener("error", finish, { once: true, signal: stopListening.signal });

    try {
      await audio.play();
    } catch {
      /* Playback refused — almost always the gesture requirement on iOS when
         this was reached without one. The device voice is subject to the same
         rule but fails more gracefully, so it is still the better answer. */
      finish();
      return local();
    }

    return {
      stop: () => { audio.pause(); finish(); },
      done
    };
  } catch {
    return local();
  }
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
