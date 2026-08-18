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

/** Both engines are held to the same range, so the dial means one thing. */
export const MIN_VOICE_RATE = 0.7;
export const MAX_VOICE_RATE = 1.4;

export function clampVoiceRate(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, value as number));
}

export function speak(text: string, language: string, rate = 1): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voice = pickVoice(language);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  /* 0.98 was the fixed default — slightly under normal, which reads as
     unhurried for long answers. It is now the baseline the owner's dial scales,
     rather than a number nobody could reach. */
  utterance.rate = clampVoiceRate(0.98 * rate);
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

/**
 * Why playback was refused, in the words of the thing that refused it.
 *
 * Every failure here reported "this device refused to play the audio", which
 * is true of four quite different problems and actionable for none of them.
 * The owner saw that line while being told, in the same breath, that the voice
 * service was configured and healthy — and the honest answer, that this device
 * would not play what had already been fetched, was sitting in an error name
 * nothing looked at.
 *
 * The pattern is the one that has worked every time in this app: a failure that
 * can describe itself gets fixed in minutes; one that cannot gets chased for
 * days.
 */
/**
 * Why the server declined to speak, in its own words rather than a guess.
 *
 * Mirrors `TtsRefusal` in `lib/ai/voice/tts.ts`. An unknown value is carried
 * through rather than flattened, because a reason this file has not been
 * taught is still more useful than "something went wrong" — and it names the
 * gap in exactly the place someone would look to close it.
 */
function declinedBecause(reason: string | null): string {
  switch (reason) {
    case "unconfigured":
      return "the premium voice is not configured — it needs both ELEVENLABS_API_KEY and NAVI_TTS_VOICE_ID";
    case "budget-exhausted":
      return "the premium voice has used its whole monthly character allowance";
    case "ledger-unreadable":
      return "the spend ledger could not be read, so premium speech is being treated as spent";
    case "too-slow":
      return "the premium voice did not start in time, so this device's voice answered instead";
    case "provider-failed":
      return "the speech service refused the request — the key may be expired or lack permission";
    case "too-long":
      return "this reply was too long to speak in the premium voice";
    case "empty":
      return "there was nothing to say";
    default:
      return `the premium voice declined${reason ? ` (${reason})` : " without saying why"}`;
  }
}

function refusalReason(name: string): string {
  if (name === "NotAllowedError") {
    return "this device would not play audio without a fresh tap — the permission earned when the conversation started was not held";
  }
  if (name === "NotSupportedError") {
    return "this device cannot play the audio format the voice service returned";
  }
  if (name === "AbortError") return "playback was interrupted before it could start";
  return `this device refused to play the audio${name ? ` (${name})` : ""}`;
}

/**
 * Wait for the element to have enough data to start, briefly.
 *
 * Bounded because this sits between a person finishing a sentence and hearing
 * an answer: a device that is not ready within a moment is one whose reply
 * should come in its own voice now rather than the better voice later.
 */
function ready(audio: HTMLAudioElement): Promise<boolean> {
  if (audio.readyState >= 3) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stop = new AbortController();
    const settle = (value: boolean) => { stop.abort(); resolve(value); };
    audio.addEventListener("canplay", () => settle(true), { once: true, signal: stop.signal });
    audio.addEventListener("error", () => settle(false), { once: true, signal: stop.signal });
    window.setTimeout(() => settle(false), 1_500);
  });
}

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
 * The priming playback, still settling.
 *
 * Held so the first real utterance can wait for it instead of racing it. The
 * first version did not, and the race silenced the whole feature two ways at
 * once: `primeSpeech` mutes the element and unmutes it in a `.finally`, so an
 * utterance starting before that ran played at zero volume; and its `.then`
 * calls `pause()`, which — arriving after the reply had started on the same
 * shared element — stopped the reply outright. Neither raises anything. Both
 * present as an app that listens, thinks, and says nothing.
 */
let priming: Promise<void> | null = null;

/**
 * Called from the tap that starts a spoken conversation.
 *
 * Never reported: a browser that refuses this is one where the device voice
 * takes over, which is a working configuration rather than a fault. It is
 * awaited, though — by `speakBest`, before it touches the same element.
 */
export function primeSpeech(): void {
  if (typeof window === "undefined") return;
  const audio = audioElement();
  /**
   * Unmuted, and that is the entire point.
   *
   * The first version muted this clip to keep it inaudible, which is precisely
   * what stopped it working. iOS permits muted playback with no gesture at all,
   * so a muted `play()` neither spends nor earns user activation — the element
   * came out of it with exactly the rights it went in with, and every later
   * `play()` of real audio was refused. The app then fell back to the device
   * voice and sounded like a robot while a paid-for voice sat one rejected
   * promise away, reporting nothing.
   *
   * It does not need muting. `SILENCE` is digital silence — every sample is
   * zero — so this is an audible playback attempt that happens to make no
   * sound, which is what the grant is given for.
   */
  audio.muted = false;
  audio.volume = 1;
  audio.src = SILENCE;
  priming = audio.play()
    .then(() => { audio.pause(); audio.currentTime = 0; })
    .catch(() => {});

  /**
   * The device voice needs its own unlock, and it is the one most likely to be
   * doing the talking.
   *
   * `speechSynthesis` is a separate API from `HTMLAudioElement` and iOS grants
   * them separately: priming the element does nothing for it. On an installed
   * app a first `speak()` outside a gesture is routinely dropped with no error
   * and no event — which is exactly the shape of "it does not talk" that has
   * no symptom to chase.
   *
   * A real word at zero volume rather than an empty string, because an empty
   * utterance is discarded by some engines without spending the grant, which
   * would make this look done while achieving nothing.
   */
  if ("speechSynthesis" in window) {
    try {
      const opener = new SpeechSynthesisUtterance("ok");
      opener.volume = 0;
      window.speechSynthesis.speak(opener);
    } catch {
      /* A browser that refuses this is one where the device voice was never
         going to work, which the caller finds out from `engine` rather than
         from an exception here. */
    }
  }
}

/** Which voice actually spoke, and why, when it was not the good one. */
export type SpokenEngine = "premium" | "device" | "silent";

/**
 * A voice that is speaking, what it is, and the one thing a caller needs to do
 * to it.
 *
 * `engine` and `why` exist because this function had four silent exits — no
 * credential, over budget, empty audio, playback refused — and every one of
 * them looked identical from outside: an app that listens, thinks, and says
 * nothing. Hours went into telling those apart by inference. A caller that can
 * put the answer on screen turns the next report of "it does not talk" into a
 * fact instead of a hunt.
 */
export type SpokenHandle = {
  stop: () => void;
  /** Resolves when the audio finishes, is stopped, or fails. Never rejects. */
  done: Promise<void>;
  engine: SpokenEngine;
  /** Why it was not the premium voice, in a few words. Empty when it was. */
  why: string;
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
export async function speakBest(text: string, language: string, rate = 1): Promise<SpokenHandle> {
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
  const local = (why: string): SpokenHandle => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return { stop: () => {}, done: Promise.resolve(), engine: "silent", why: "this browser has no speech at all" };
    }
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => { settle = resolve; });
    let poll = 0;
    let guard = 0;
    const finish = () => { window.clearInterval(poll); window.clearTimeout(guard); settle(); };
    /**
     * A ceiling on the whole utterance, because `speechSynthesis` can accept a
     * request and never speak.
     *
     * On an installed iOS app it is routinely ignored outright — no error, no
     * event, `speaking` never turns true. The poll below waits for a start that
     * never comes, `done` never resolves, and the conversation sits on
     * "Answering" with the microphone shut until it is ended by hand. A loop
     * that cannot hear its own voice must at least be able to give up on it.
     */
    guard = window.setTimeout(finish, 60_000);

    whenVoicesReady(() => {
      speak(text, language, rate);
      /* Started after the utterance is queued, and tolerant of the gap before
         `speaking` flips true — a poll that fires in that window would end the
         turn before a word was said. */
      let started = false;
      poll = window.setInterval(() => {
        if (window.speechSynthesis.speaking) { started = true; return; }
        if (started) finish();
      }, 300);
    });

    return { stop: () => { window.speechSynthesis.cancel(); finish(); }, done, engine: "device", why };
  };

  if (typeof window === "undefined") return local("there is no browser here");

  try {
    const response = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* The premium voice takes a speed of its own, so the same dial moves
         both engines rather than only the fallback. */
      body: JSON.stringify({ text, rate })
    });
    /* 204 is the server saying "use the local voice" and is not a fault — but
       it is seven different situations wearing one status, and the person
       hearing the wrong voice deserves to know which.

       The reason has been travelling in `X-Navi-Speech` since the route was
       written, and nothing here read it: the client guessed a three-way list
       aloud — "unconfigured, over its budget, or was too slow" — while the
       server knew the answer exactly. Two rounds of this were spent trying to
       tell those three apart from the outside. */
    if (response.status === 204) return local(declinedBecause(response.headers.get("X-Navi-Speech")));
    if (response.status !== 200 || !response.body) return local(`the speech service answered ${response.status}`);

    const blob = await response.blob();
    if (!blob.size) return local("the speech service returned no audio");

    const url = URL.createObjectURL(blob);
    /* The shared element, so a conversation's second reply plays on the grant
       its first tap earned. Each utterance gets its own listeners and takes
       them away again on the way out — a reused element that accumulates them
       would settle every previous utterance's promise on this one's end. */
    /* Let the priming clip finish before taking the element over. Without this
       its own `pause()` lands on this utterance and its `muted` flag is still
       set when this one starts — the two ways a conversation ends up silent. */
    if (priming) { await priming; priming = null; }
    const audio = audioElement();
    audio.pause();
    /* Belt and braces: whatever happened before, an utterance is audible. */
    audio.muted = false;
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
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      /* An abort is not a refusal. Assigning `src` above cancels any load
         already in flight, and `play()` rejects with `AbortError` — the device
         was willing and the request was interrupted. Waiting for the element to
         be ready and asking once more is the standard remedy, and it costs one
         event. Retried only for this name: retrying a genuine refusal just
         fails twice. */
      const retried = name === "AbortError" && await ready(audio)
        ? await audio.play().then(() => true).catch(() => false)
        : false;

      if (!retried) {
        finish();
        return local(refusalReason(name));
      }
    }

    return {
      stop: () => { audio.pause(); finish(); },
      done,
      engine: "premium",
      why: ""
    };
  } catch {
    return local("the speech service could not be reached");
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
