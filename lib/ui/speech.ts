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
 * The stored preference resolved to a real BCP-47 tag. `auto` means the
 * device's own language; anything else is an explicit choice, honoured as given.
 */
export function resolveVoiceLanguage(preference: string | undefined): string {
  if (!preference || preference === "auto") {
    return (typeof navigator === "undefined" ? "" : navigator.language) || "en-US";
  }
  return preference;
}
