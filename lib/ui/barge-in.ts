/**
 * Interrupting the app by talking over it.
 *
 * The conversation loop is half-duplex: it listens, thinks, speaks, and only
 * then listens again. That is the right default — it is simple, it cannot hear
 * itself, and it was hard-won. But it makes one thing impossible that every
 * real conversation allows, and the owner named it exactly:
 *
 *   "when it talks back to me, it writes the chat, but then it doesn't let me
 *    interrupt by talking. which it should."
 *
 * They are right. Being unable to stop someone who has misunderstood you, or
 * who is three sentences into an answer you no longer want, is the difference
 * between talking to something and waiting for it.
 *
 * ## Why this is separate from the recorder
 *
 * It is not recording. It never captures a sample, never uploads anything, and
 * produces no transcript — it answers one question, "is a person talking right
 * now", and hands back the decision. Keeping it out of `recorder.ts` keeps the
 * transcription path exactly as it is, which matters: that path is the one that
 * took several rounds to get right, and a listener that runs *during playback*
 * is a genuinely different problem from one that runs instead of it.
 *
 * ## Hearing itself
 *
 * The obvious failure is the app interrupting its own voice through the phone's
 * speaker. Three things guard against it, in order of how much work they do:
 *
 * 1. **Echo cancellation**, which is what the browser's own AEC is for and
 *    handles most of it.
 * 2. **A calibrated floor.** The first moments of monitoring happen while the
 *    reply is already playing, so whatever leaks through *is* the baseline. The
 *    threshold is set above what was measured rather than at a number chosen
 *    here, because how loud a phone is depends on the phone.
 * 3. **Sustained energy.** A person interrupting talks for a while; a syllable
 *    of leaked audio does not. Held above the floor for a continuous stretch
 *    before it counts.
 *
 * ## Failing safe
 *
 * Every failure returns a watcher that does nothing. A microphone that will not
 * open, an audio context that will not start, a browser without the APIs — all
 * of them leave the conversation exactly as it is today, speaking to the end.
 * Losing the ability to interrupt is a smaller harm than a loop that breaks,
 * and this runs on a device none of it can be tested against from here.
 */

export type BargeInWatch = { stop: () => void };

/** A watcher that does nothing, for every path where listening is impossible. */
const INERT: BargeInWatch = { stop: () => {} };

/** How long a voice must stay above the floor before it counts as interrupting. */
const HOLD_MS = 420;
/** Ignored entirely at first, while the reply's own audio sets the baseline. */
const CALIBRATE_MS = 500;
/** How far above the measured floor a voice has to be. */
const MARGIN = 2.5;
/** Below this, the room is silent and the floor should not be trusted upward. */
const MIN_FLOOR = 0.012;

/**
 * Watch for the person talking, and say so once.
 *
 * `onSpeech` fires at most once; the caller decides what interrupting means.
 */
export async function watchForInterruption(options: {
  onSpeech: () => void;
  holdMs?: number;
}): Promise<BargeInWatch> {
  if (typeof window === "undefined") return INERT;
  if (typeof navigator?.mediaDevices?.getUserMedia !== "function") return INERT;

  const AudioContextCtor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return INERT;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        /* The whole reason this can work at all: the browser removes what the
           speaker is playing from what the microphone hears. */
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
  } catch {
    /* Permission refused, device busy, or another app holding it. The reply
       plays to the end, which is what happens today. */
    return INERT;
  }

  let context: AudioContext;
  try {
    context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    /* Smoothed, because a single frame of a consonant is not a person talking
       and the point is to notice speech rather than noise. */
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let floor = MIN_FLOOR;
    let aboveSince = 0;
    let fired = false;
    let timer = 0;

    const release = () => {
      window.clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => {});
    };

    timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.sqrt(sum / samples.length);

      const elapsed = Date.now() - startedAt;
      if (elapsed < CALIBRATE_MS) {
        /* Whatever is audible now is the reply itself leaking back, so it is
           the floor rather than an interruption. */
        floor = Math.max(floor, level);
        return;
      }

      if (level > floor * MARGIN) {
        aboveSince ||= Date.now();
        if (!fired && Date.now() - aboveSince >= (options.holdMs ?? HOLD_MS)) {
          fired = true;
          release();
          options.onSpeech();
        }
        return;
      }
      aboveSince = 0;
    }, 60);

    return { stop: release };
  } catch {
    for (const track of stream.getTracks()) track.stop();
    return INERT;
  }
}
