/**
 * Deciding what is speech, and where a recording may be cut.
 *
 * This is the part that makes dictation feel instant rather than merely work.
 * The old recorder had no idea what it was holding: it recorded until a button
 * was pressed and then uploaded the lot, so the wait after Stop was the length
 * of the whole utterance, every time. Words can only arrive while someone is
 * still talking if something decides, live, that a stretch of audio is a
 * finished piece of speech — and that decision is this file.
 *
 * Two hard-won points about how it is done.
 *
 * It works in decibels against a floor it measures, not against a fixed
 * number. A threshold like "0.045 amplitude" is a threshold for one room. In a
 * café it is under the noise and the app transcribes the room; through a car
 * kit it is over the voice and the app hears nothing. The floor here is
 * measured continuously from the quiet parts and the threshold rides ten
 * decibels above it, which is the same sentence in every room.
 *
 * And it is deliberately reluctant in both directions. Opening needs sixty
 * milliseconds of sound so a door does not start a segment; closing needs
 * seven hundred of quiet so a breath between clauses does not end one. Those
 * two numbers are most of the felt difference between dictation that keeps up
 * and dictation that chops you off mid-sentence.
 *
 * Pure, and driven by a level per hop rather than by a clock, so the shapes
 * that matter — a clause gap, a quiet talker, a room that is never silent, a
 * sentence that never ends — are tests over arrays of numbers instead of
 * things you can only meet on a phone.
 */

import { dbfs } from "./pcm";

/**
 * How often a decision is made, in milliseconds.
 *
 * Twenty is the standard analysis frame for speech and it is not arbitrary:
 * shorter than a phoneme, so nothing is averaged across a sound boundary, and
 * long enough that a single glottal pulse does not read as an onset.
 */
export const HOP_MS = 20;

/** How a turn ended, when the caller asked for turns to end on their own. */
export type TurnEnd = "spoke" | "silent" | "too-long";

export type SegmentBoundary = "pause" | "split";

export type SegmentCut = {
  /** First hop of the segment, inclusive. */
  startHop: number;
  /** One past the last hop, exclusive. */
  endHop: number;
  /**
   * Why the segment ended here.
   *
   * `pause` means it ended where the speaker did, so the text is a complete
   * thought and joins onto the next with a space. `split` means the ceiling
   * was hit mid-sentence and the cut was placed at the quietest moment we
   * could find — the audio deliberately overlaps the next segment, so the
   * words may too, and the caller has to reconcile that.
   */
  boundary: SegmentBoundary;
};

export type SegmenterEvent =
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "segment"; cut: SegmentCut }
  | { type: "turn-end"; reason: TurnEnd };

export type SegmenterOptions = {
  hopMs?: number;
  /**
   * Audio kept from before speech was confirmed.
   *
   * A detector needs evidence, and gathering it takes time, so by the moment
   * it is sure the word has already started. Without this the first consonant
   * of every utterance is missing — "sat" for "that" — which reads as the
   * transcriber being poor rather than the recording being clipped.
   */
  preRollMs?: number;
  /**
   * Silence kept after the last speech.
   *
   * Some is needed or the final consonant is cut. Much more than this is
   * actively harmful: Whisper is known to invent text over long silences, and
   * a trailing second of nothing is the most reliable way to be handed a
   * sentence that was never said.
   */
  tailMs?: number;
  /** Sound above the threshold needed to open a segment. */
  onsetMs?: number;
  /** Quiet needed to close one. Longer than the gap between clauses. */
  hangoverMs?: number;
  /** Speech a segment must contain to be worth uploading. */
  minSpeechMs?: number;
  /** The longest a segment may run before it is cut mid-sentence. */
  maxSegmentMs?: number;
  /** How far back to look for a quiet moment when forced to cut. */
  splitSearchMs?: number;
  /** How much audio either side of a forced cut appears in both segments. */
  splitOverlapMs?: number;
  /** Threshold above the measured floor, in decibels. */
  onsetMarginDb?: number;
  /** Where speech is considered to have stopped, below the onset threshold. */
  releaseMarginDb?: number;
  /**
   * A threshold the floor may never drag below.
   *
   * A muted or disconnected microphone reads as digital silence, which puts
   * the measured floor near −100 dB and makes the faintest electrical noise
   * "ten decibels above the room". This is the floor of the floor.
   */
  absoluteFloorDb?: number;
  /** Hands-free: end the turn this long after the speaker stops. */
  endAfterSilenceMs?: number;
  /** Hands-free: give up if nothing is ever said. */
  noSpeechMs?: number;
  /** Stop regardless once a recording reaches this length. */
  maxRecordingMs?: number;
};

export type SegmenterState = {
  speaking: boolean;
  /** The measured room level, in dBFS. */
  floorDb: number;
  /** What it currently takes to count as speech, in dBFS. */
  onsetDb: number;
  /** Hops consumed since the recording started. */
  hop: number;
  /** Whether any speech has been confirmed at all. */
  heardSpeech: boolean;
};

export type Segmenter = {
  /** Feed one hop's RMS amplitude. Returns everything that hop decided. */
  push(level: number): SegmenterEvent[];
  /** Close whatever is open, at the end of a recording. */
  flush(): SegmenterEvent[];
  /** The earliest hop the caller still has to be holding audio for. */
  retainFromHop(): number;
  state(): SegmenterState;
  reset(): void;
};

/* Defaults. Each of these is a felt behaviour rather than a tuning knob, so
   the reasoning lives on the option it belongs to above. */
const DEFAULTS = {
  hopMs: HOP_MS,
  preRollMs: 320,
  tailMs: 250,
  onsetMs: 60,
  hangoverMs: 700,
  minSpeechMs: 100,
  maxSegmentMs: 14_000,
  splitSearchMs: 2_500,
  splitOverlapMs: 300,
  onsetMarginDb: 10,
  releaseMarginDb: 5,
  absoluteFloorDb: -52,
  endAfterSilenceMs: 0,
  noSpeechMs: 0,
  maxRecordingMs: 0
} satisfies Required<SegmenterOptions>;

/**
 * How fast the measured floor follows the room.
 *
 * Asymmetric, and that asymmetry is the whole design. Downwards it moves
 * quickly, because a room getting quieter should immediately make quiet speech
 * detectable. Upwards it crawls, because the things that make a room briefly
 * louder are a chair, a cough, a passing car — and a floor that chased them
 * would spend the next few seconds unable to hear the person talking.
 */
const FLOOR_FALL = 0.35;
const FLOOR_RISE = 0.02;

/** Bounds on the measured floor, past which it has stopped meaning "the room". */
const FLOOR_MIN_DB = -75;
const FLOOR_MAX_DB = -25;

export function createSegmenter(options: SegmenterOptions = {}): Segmenter {
  const settings = { ...DEFAULTS, ...options };
  const hops = (ms: number) => Math.max(1, Math.round(ms / settings.hopMs));

  const preRollHops = hops(settings.preRollMs);
  const tailHops = hops(settings.tailMs);
  const onsetHops = hops(settings.onsetMs);
  const hangoverHops = hops(settings.hangoverMs);
  const minSpeechHops = hops(settings.minSpeechMs);
  const maxSegmentHops = hops(settings.maxSegmentMs);
  const splitSearchHops = hops(settings.splitSearchMs);
  const splitOverlapHops = hops(settings.splitOverlapMs);
  /* Hysteresis: the gap between opening and closing. Kept as a difference
     rather than as two independent thresholds so that clamping the onset
     against the absolute floor cannot collapse the two into one value and
     leave the detector chattering on a single sample. */
  const hysteresisDb = Math.max(1, settings.onsetMarginDb - settings.releaseMarginDb);

  const endAfterSilenceHops = settings.endAfterSilenceMs ? hops(settings.endAfterSilenceMs) : 0;
  const noSpeechHops = settings.noSpeechMs ? hops(settings.noSpeechMs) : 0;
  const maxRecordingHops = settings.maxRecordingMs ? hops(settings.maxRecordingMs) : 0;

  let hop = 0;
  let floorDb = Number.NaN;
  let speaking = false;
  let aboveRun = 0;
  let belowRun = 0;
  let segmentOpen = false;
  let segmentStartHop = 0;
  let speechHopsInSegment = 0;
  let lastSpeechHop = -1;
  let heardSpeech = false;
  let turnEnded = false;
  /* Recent levels, for choosing where to cut when a sentence runs past the
     ceiling. One number per hop, oldest first, capped at the search window. */
  let recent: { hop: number; db: number }[] = [];

  function thresholds() {
    const base = Number.isNaN(floorDb) ? FLOOR_MIN_DB : floorDb;
    const onsetDb = Math.max(base + settings.onsetMarginDb, settings.absoluteFloorDb);
    return { onsetDb, releaseDb: onsetDb - hysteresisDb };
  }

  /**
   * Hand over the open segment, unless it holds no speech.
   *
   * A segment with almost nothing in it is a chair scraping, and uploading it
   * costs a request and returns either nothing or — worse — an invented
   * sentence. The caller decides what happens to the segment pointer
   * afterwards, because a pause ends the segment and a forced split only
   * moves its start.
   */
  function emitSegment(endHop: number, boundary: SegmentBoundary, events: SegmenterEvent[]) {
    if (endHop <= segmentStartHop) return;
    if (speechHopsInSegment < minSpeechHops) return;
    events.push({ type: "segment", cut: { startHop: segmentStartHop, endHop, boundary } });
  }

  /** The quietest hop in the recent window, which is where a cut hurts least. */
  function quietestHop(): number {
    /* Never cut at the very present moment: the next segment starts before the
       cut so a word straddling it is captured twice rather than lost, and that
       overlap has to come from audio that already exists. */
    const latest = hop - splitOverlapHops;
    const earliest = Math.max(segmentStartHop + minSpeechHops, hop - splitSearchHops);
    let bestHop = latest;
    let bestDb = Number.POSITIVE_INFINITY;
    for (const sample of recent) {
      if (sample.hop < earliest || sample.hop > latest) continue;
      if (sample.db < bestDb) {
        bestDb = sample.db;
        bestHop = sample.hop;
      }
    }
    return Math.max(earliest, Math.min(latest, bestHop));
  }

  function push(level: number): SegmenterEvent[] {
    const events: SegmenterEvent[] = [];
    if (turnEnded) return events;

    const db = dbfs(level);
    const current = hop;
    hop += 1;

    recent.push({ hop: current, db });
    if (recent.length > splitSearchHops + splitOverlapHops + 2) recent = recent.slice(-(splitSearchHops + splitOverlapHops + 2));

    if (Number.isNaN(floorDb)) floorDb = Math.min(FLOOR_MAX_DB, Math.max(FLOOR_MIN_DB, db));

    const { onsetDb, releaseDb } = thresholds();

    if (!speaking) {
      /* The floor is only measured while nobody is talking. Letting speech
         into the average is how a long sentence raises the threshold above
         itself and the detector closes in the middle of it. */
      const rate = db < floorDb ? FLOOR_FALL : FLOOR_RISE;
      floorDb = Math.min(FLOOR_MAX_DB, Math.max(FLOOR_MIN_DB, floorDb + (db - floorDb) * rate));

      aboveRun = db >= onsetDb ? aboveRun + 1 : 0;
      if (aboveRun >= onsetHops) {
        speaking = true;
        heardSpeech = true;
        belowRun = 0;
        lastSpeechHop = current;
        if (!segmentOpen) {
          segmentOpen = true;
          /* Backdated past the evidence-gathering and then further still, so
             the segment begins before the word did. */
          segmentStartHop = Math.max(0, current - aboveRun + 1 - preRollHops);
          speechHopsInSegment = 0;
        }
        speechHopsInSegment += aboveRun;
        events.push({ type: "speech-start" });
      }
    } else {
      if (db >= releaseDb) {
        belowRun = 0;
        lastSpeechHop = current;
        speechHopsInSegment += 1;
      } else {
        belowRun += 1;
      }

      if (belowRun >= hangoverHops) {
        speaking = false;
        aboveRun = 0;
        events.push({ type: "speech-end" });
        if (segmentOpen) {
          emitSegment(Math.min(current + 1, lastSpeechHop + 1 + tailHops), "pause", events);
          segmentOpen = false;
          speechHopsInSegment = 0;
        }
      }
    }

    /* A sentence that has run past the ceiling. Cut at the quietest recent
       moment rather than at the ceiling itself: the odds of that being between
       words instead of inside one are far better, and the next segment starts
       before the cut so nothing falls between them. */
    if (segmentOpen && current + 1 - segmentStartHop >= maxSegmentHops) {
      const splitHop = quietestHop();
      const openedAt = segmentStartHop;
      emitSegment(splitHop, "split", events);
      /* The segment does not end here, it only restarts — the speaker is
         still mid-sentence, which is why this cut had to be invented in the
         first place. The continuation inherits the speech it is in the middle
         of rather than having to re-earn it. */
      segmentStartHop = Math.max(openedAt + 1, splitHop - splitOverlapHops);
      speechHopsInSegment = minSpeechHops;
    }

    if (maxRecordingHops && hop >= maxRecordingHops) {
      turnEnded = true;
      events.push({ type: "turn-end", reason: "too-long" });
      return events;
    }
    if (!heardSpeech && noSpeechHops && hop >= noSpeechHops) {
      turnEnded = true;
      events.push({ type: "turn-end", reason: "silent" });
      return events;
    }
    if (heardSpeech && !speaking && endAfterSilenceHops && current - lastSpeechHop >= endAfterSilenceHops) {
      turnEnded = true;
      events.push({ type: "turn-end", reason: "spoke" });
    }

    return events;
  }

  return {
    push,
    flush() {
      const events: SegmenterEvent[] = [];
      if (speaking) {
        speaking = false;
        events.push({ type: "speech-end" });
      }
      if (segmentOpen) {
        emitSegment(Math.min(hop, Math.max(lastSpeechHop + 1 + tailHops, segmentStartHop + 1)), "pause", events);
        segmentOpen = false;
        speechHopsInSegment = 0;
      }
      return events;
    },
    retainFromHop() {
      /* While a segment is open every hop of it is still needed. While none
         is, only the pre-roll window is — everything older can be dropped,
         which is what keeps a long recording from growing without bound. */
      return segmentOpen ? segmentStartHop : Math.max(0, hop - preRollHops - onsetHops);
    },
    state() {
      return {
        speaking,
        floorDb: Number.isNaN(floorDb) ? FLOOR_MIN_DB : floorDb,
        onsetDb: thresholds().onsetDb,
        hop,
        heardSpeech
      };
    },
    reset() {
      hop = 0;
      floorDb = Number.NaN;
      speaking = false;
      aboveRun = 0;
      belowRun = 0;
      segmentOpen = false;
      segmentStartHop = 0;
      speechHopsInSegment = 0;
      lastSpeechHop = -1;
      heardSpeech = false;
      turnEnded = false;
      recent = [];
    }
  };
}

/**
 * Join two transcripts that were cut apart mid-sentence.
 *
 * A forced split deliberately overlaps the audio either side of the cut, so a
 * word straddling it is recorded twice rather than lost — which means it can
 * also be transcribed twice, and "the quick brown" + "brown fox jumps" has to
 * become one sentence rather than a stutter.
 *
 * The rule is the longest overlap that actually matches: take the last N words
 * of the first piece, compare against the first N of the second with case and
 * punctuation ignored, and drop the duplicate. Longest first, because a single
 * matching word is very often a genuine repetition — "no, no" — while four
 * matching words in a row never is.
 *
 * Only ever applied across a forced split. At a natural pause the speaker
 * really did stop, and deleting a repeated word there would be deleting
 * something they said.
 */
export function mergeSplitTranscripts(first: string, second: string, maxOverlapWords = 8): string {
  const left = first.trim();
  const right = second.trim();
  if (!left) return right;
  if (!right) return left;

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const normalise = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

  const limit = Math.min(maxOverlapWords, leftWords.length, rightWords.length);
  for (let size = limit; size >= 2; size -= 1) {
    const tail = leftWords.slice(-size).map(normalise);
    const head = rightWords.slice(0, size).map(normalise);
    if (tail.every((word, index) => word.length > 0 && word === head[index])) {
      const remainder = rightWords.slice(size).join(" ");
      return remainder ? `${left} ${remainder}` : left;
    }
  }

  return `${left} ${right}`;
}
