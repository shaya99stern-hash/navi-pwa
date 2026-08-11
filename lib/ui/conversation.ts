/**
 * Deciding when someone has stopped talking.
 *
 * Voice mode was a dictation box: hold the thought, press Stop, read the
 * transcript, press Send. Four deliberate acts per turn, three of them
 * requiring a hand and eyes. The whole point of talking to something is not
 * having to do that, and it is the single largest felt gap against Claude's
 * voice mode.
 *
 * Continuous listening needs one thing the dictation flow got from a button:
 * knowing the turn is over. The transcriber cannot help — it runs after the
 * recording stops, which is the decision being made. So this reads the live
 * microphone level the recorder already publishes and decides from the shape
 * of it.
 *
 * Pure, and separated from the sheet on purpose. Endpoint detection is the part
 * that is genuinely easy to get wrong and impossible to eyeball: every failure
 * is a timing bug in a browser, on a phone, mid-sentence. Here it is a function
 * over a list of numbers, and the tests feed it the shapes that matter — a
 * pause mid-sentence, a quiet talker, a room that is never truly silent.
 */

export type TurnDetectorOptions = {
  /**
   * Level above which we consider someone to be talking, 0 to 1.
   *
   * The recorder's level is a normalised RMS of the waveform. A quiet room
   * with a laptop fan sits well under 0.02; ordinary speech at arm's length
   * runs 0.05 to 0.3. This sits above the room and below the talker.
   */
  speechLevel?: number;
  /**
   * Quiet time that ends a turn.
   *
   * The number that decides whether this feels like a conversation or an
   * interruption. Too short and it cuts in while someone is thinking mid
   * sentence; too long and every exchange has a dead beat in it. People pause
   * around 200-500ms between clauses and longer between sentences, so this sits
   * past the clause gap and inside the patience of someone waiting for a reply.
   */
  silenceMs?: number;
  /** Give up if nothing is ever said, so an open mic does not hang a turn. */
  noSpeechMs?: number;
  /**
   * Stop regardless once a turn runs this long.
   *
   * The transcriber has its own ceiling on clip length, and a turn that reaches
   * this has almost certainly left the microphone open in a noisy room.
   */
  maxTurnMs?: number;
};

export type TurnEnd = "spoke" | "silent" | "too-long";

export type TurnDetector = {
  /**
   * Feed one level sample. Returns how the turn ended, or null to keep going.
   *
   * Takes `now` rather than reading the clock so the tests can drive time
   * directly — an endpoint detector tested against real timers is a test that
   * takes four seconds and fails on a slow machine.
   */
  push(level: number, now: number): TurnEnd | null;
  /** Whether any speech has been heard at all this turn. */
  heardSpeech(): boolean;
  reset(now: number): void;
};

export function createTurnDetector(options: TurnDetectorOptions = {}): TurnDetector {
  const speechLevel = options.speechLevel ?? 0.045;
  const silenceMs = options.silenceMs ?? 1_100;
  const noSpeechMs = options.noSpeechMs ?? 6_000;
  const maxTurnMs = options.maxTurnMs ?? 45_000;

  let startedAt = 0;
  let speechAt = 0;
  let quietSince = 0;
  let done = false;

  return {
    push(level, now) {
      if (done) return null;
      if (!startedAt) startedAt = now;

      if (now - startedAt >= maxTurnMs) { done = true; return "too-long"; }

      if (level >= speechLevel) {
        /* Any sample above the threshold resets the silence timer, which is
           what stops a clause gap from ending the turn. */
        if (!speechAt) speechAt = now;
        quietSince = 0;
        return null;
      }

      /* Nothing said yet. A turn that opens on an empty room is ended by its
         own timer rather than by the silence rule, so the caller can tell
         "you stopped talking" from "you never started" and not send an empty
         clip to the transcriber. */
      if (!speechAt) {
        return now - startedAt >= noSpeechMs ? ((done = true), "silent") : null;
      }

      if (!quietSince) quietSince = now;
      if (now - quietSince >= silenceMs) { done = true; return "spoke"; }
      return null;
    },
    heardSpeech() {
      return speechAt > 0;
    },
    reset(now) {
      startedAt = now;
      speechAt = 0;
      quietSince = 0;
      done = false;
    }
  };
}
