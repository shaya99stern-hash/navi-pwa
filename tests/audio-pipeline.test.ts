import {
  TARGET_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  concatFloat32,
  createHighPass,
  createResampler,
  dbfs,
  encodeWav,
  float32ToInt16,
  rms
} from "@/lib/ui/audio/pcm";
import { HOP_MS, createSegmenter, mergeSplitTranscripts, type SegmenterEvent } from "@/lib/ui/audio/vad";

/**
 * The dictation pipeline, checked against arithmetic instead of against a
 * phone.
 *
 * Everything here used to be either impossible to test or absent. The old
 * recorder handed a MediaRecorder blob straight to the network, so there was
 * nothing between the microphone and the wire to make an assertion about —
 * which is why every defect in it was found by a person holding a device,
 * usually the wrong device, usually once.
 *
 * The failures these cover all sound fine to a human ear and transcribe as
 * nonsense: a resampler that aliases, a filter that forgets its state between
 * callbacks, a WAV header off by four bytes, a voice detector calibrated for
 * one room. And the two that are worse than nonsense, because they are
 * silent: a segment cut through the middle of a word, and speech clipped
 * before the detector was sure it had started.
 */

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};
const near = (name: string, actual: number, expected: number, tolerance: number) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${actual}\n   want: ${expected} ±${tolerance}`}`);
};

function sine(frequency: number, sampleRate: number, samples: number, amplitude = 1, phase = 0): Float32Array {
  const out = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    out[index] = amplitude * Math.sin(2 * Math.PI * frequency * ((index + phase) / sampleRate));
  }
  return out;
}

/** Frequency estimated from zero crossings, which is enough to catch aliasing. */
function estimateHz(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index - 1] < 0 && samples[index] >= 0) || (samples[index - 1] >= 0 && samples[index] < 0)) crossings += 1;
  }
  return (crossings * sampleRate) / (2 * samples.length);
}

/* ── WAV, written by hand ──────────────────────────────────────────────────
   This is the change that removed "that audio format was rejected" as a class
   of failure. Nothing negotiates a container any more, which only holds if
   the forty-four bytes below are actually right — and a wrong header does not
   fail loudly, it transcribes as silence. */

{
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
  const view = new DataView(wav);
  const ascii = (offset: number, length: number) =>
    Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");

  check("the file is RIFF/WAVE", [ascii(0, 4), ascii(8, 4)], ["RIFF", "WAVE"]);
  check("with a fmt and a data chunk", [ascii(12, 4), ascii(36, 4)], ["fmt ", "data"]);
  check("declaring uncompressed PCM", view.getUint16(20, true), 1);
  check("mono", view.getUint16(22, true), 1);
  check("at the rate the transcriber wants", view.getUint32(24, true), 16_000);
  check("sixteen bits a sample", view.getUint16(34, true), 16);
  /* Byte rate and block align are redundant with the fields above, and a
     decoder that trusts them over the others produces audio at the wrong
     speed — which transcribes as a different language. */
  check("byte rate agrees with the rest of the header", view.getUint32(28, true), 32_000);
  check("block align agrees too", view.getUint16(32, true), 2);

  check("the total length is header plus payload", wav.byteLength, WAV_HEADER_BYTES + samples.length * 2);
  /* RIFF's size field counts everything after itself, which is the file minus
     the eight bytes of "RIFF" and the field. Off by those eight is the single
     most common way a hand-written header fails. */
  check("the RIFF size excludes its own eight bytes", view.getUint32(4, true), wav.byteLength - 8);
  check("the data size is the payload alone", view.getUint32(40, true), samples.length * 2);

  /* Written as literals rather than as the expression the encoder uses, so
     this compares against arithmetic rather than against itself. Assignment
     into an Int16Array truncates toward zero, which is why the positive value
     is 16383 and not 16384 — a difference of one part in thirty-two thousand,
     forty decibels below anything audible. */
  check("samples are little-endian signed 16-bit", [
    view.getInt16(44, true),
    view.getInt16(46, true),
    view.getInt16(48, true)
  ], [0, 16_383, -16_384]);
}

{
  /* Full scale in both directions. Scaling positives by 32768 wraps the
     loudest sample of a recording to full-scale negative — a click at exactly
     the moment someone raised their voice. */
  const extremes = float32ToInt16(new Float32Array([1, -1, 2, -2]));
  check("positive full scale does not wrap", extremes[0], 32_767);
  check("negative full scale uses the extra step", extremes[1], -32_768);
  check("and anything beyond is clamped rather than wrapped", [extremes[2], extremes[3]], [32_767, -32_768]);
}

/* ── Resampling ────────────────────────────────────────────────────────────
   Devices record at 44.1 or 48 kHz; the transcriber works at 16. Getting from
   one to the other wrongly is inaudible to a person and ruinous to a model. */

{
  const resampler = createResampler(48_000, 16_000);
  const input = sine(1_000, 48_000, 48_000, 0.5);
  const output = resampler.push(input);

  near("48 kHz to 16 kHz produces a third of the samples", output.length, 16_000, 40);
  /* Trimmed at both ends: the filter has a settling time at the start and the
     last few samples are still filling. */
  const settled = output.subarray(200, output.length - 200);
  near("a 1 kHz tone is still 1 kHz", estimateHz(settled, 16_000), 1_000, 15);
  near("and keeps its level", rms(settled), 0.5 / Math.SQRT2, 0.02);
}

{
  /* The one that matters. Decimating without filtering first folds everything
     above 8 kHz back down into the speech band — a 12 kHz hiss reappears as a
     4 kHz tone sitting on top of the vowels. It does not sound like
     distortion; it sounds like a second, quieter voice. */
  const resampler = createResampler(48_000, 16_000);
  const output = resampler.push(sine(12_000, 48_000, 48_000, 0.5));
  const settled = output.subarray(400, output.length - 400);
  check("content above the output Nyquist is removed, not folded down", rms(settled) < 0.01, true);

  const naive = new Float32Array(16_000);
  const unfiltered = sine(12_000, 48_000, 48_000, 0.5);
  for (let index = 0; index < naive.length; index += 1) naive[index] = unfiltered[index * 3];
  check("which decimating on its own would not do", rms(naive) > 0.2, true);
  near("it would have aliased to 4 kHz", estimateHz(naive, 16_000), 4_000, 100);
}

{
  /* Frames arrive a thousand samples at a time. A resampler that starts fresh
     on each one restarts its filter with an empty history and resets its
     fractional read position — a click at every boundary, fifty times a
     second, which a transcriber hears as consonants nobody spoke. */
  const whole = createResampler(48_000, 16_000).push(sine(1_000, 48_000, 12_288, 0.5));

  const piecewise = createResampler(48_000, 16_000);
  const pieces: Float32Array[] = [];
  const source = sine(1_000, 48_000, 12_288, 0.5);
  for (let offset = 0; offset < source.length; offset += 1_024) {
    pieces.push(piecewise.push(source.subarray(offset, offset + 1_024)).slice());
  }
  const joined = concatFloat32(pieces);

  check("frame-by-frame produces the same number of samples", joined.length, whole.length);
  let worst = 0;
  for (let index = 0; index < whole.length; index += 1) worst = Math.max(worst, Math.abs(whole[index] - joined[index]));
  check("and the same samples, so there is no click at any boundary", worst < 1e-6, true);
}

{
  /* 44.1 kHz is not a whole multiple of 16, so the read position lands between
     samples for ever and the carry between frames has to be fractional. */
  const resampler = createResampler(44_100, 16_000);
  const output = resampler.push(sine(1_000, 44_100, 44_100, 0.5));
  near("a non-integer ratio still produces the right count", output.length, 16_000, 40);
  near("and the right pitch", estimateHz(output.subarray(200, output.length - 200), 16_000), 1_000, 15);
}

{
  const identity = createResampler(16_000, 16_000);
  const input = sine(1_000, 16_000, 1_024, 0.5);
  check("a device already at the target rate is passed straight through", identity.push(input), input);
}

/* ── The DC blocker ───────────────────────────────────────────────────────── */

{
  const highPass = createHighPass(TARGET_SAMPLE_RATE);
  const offset = new Float32Array(8_000).fill(0.4);
  const output = highPass(offset);
  check("a constant offset is removed", Math.abs(output[output.length - 1]) < 0.01, true);
}

{
  const highPass = createHighPass(TARGET_SAMPLE_RATE);
  const voice = highPass(sine(200, TARGET_SAMPLE_RATE, 8_000, 0.5));
  near("but the voice itself passes", rms(voice.subarray(500)), 0.5 / Math.SQRT2, 0.03);
}

{
  const highPass = createHighPass(TARGET_SAMPLE_RATE);
  const first = highPass(new Float32Array(320).fill(0.4));
  const second = highPass(new Float32Array(320).fill(0.4));
  /* State carries across calls, so the offset stays removed rather than
     being re-introduced at the start of every frame. */
  check("and its state survives a frame boundary", Math.abs(second[0]) < Math.abs(first[0]), true);
}

/* ── Levels ───────────────────────────────────────────────────────────────── */

{
  near("RMS of a sine is its amplitude over root two", rms(sine(440, 16_000, 16_000, 0.8)), 0.8 / Math.SQRT2, 0.001);
  near("full scale is zero dBFS", dbfs(1), 0, 0.001);
  near("half amplitude is six decibels down", dbfs(0.5), -6.02, 0.01);
  check("silence does not produce negative infinity", Number.isFinite(dbfs(0)), true);
}

/* ── Voice activity ────────────────────────────────────────────────────────
   The detector this replaced compared the level against a fixed 0.045. That
   is a threshold for one room: in a café it sits under the noise and the app
   transcribes the room, and through a car kit it sits over the voice and the
   app hears nothing. */

type Segmenter = ReturnType<typeof createSegmenter>;

/** Feed a level for a stretch of time and collect everything it decided. */
function play(segmenter: Segmenter, level: number, ms: number): SegmenterEvent[] {
  const events: SegmenterEvent[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += HOP_MS) events.push(...segmenter.push(level));
  return events;
}

const kinds = (events: SegmenterEvent[]) => events.map((event) => event.type);
const segmentsIn = (events: SegmenterEvent[]) =>
  events.flatMap((event) => (event.type === "segment" ? [event.cut] : []));

const QUIET = 0.002;   // a room at three in the morning
const ROOM = 0.02;     // a room with a fan and a laptop in it
const SPEECH = 0.15;   // ordinary speech at arm's length

{
  const segmenter = createSegmenter();
  const events = play(segmenter, QUIET, 4_000);
  check("an empty room never starts a segment", kinds(events), []);
  check("and nothing is uploaded", segmentsIn(events).length, 0);
  check("nor is anything held in memory for it", segmenter.retainFromHop() > 150, true);
}

{
  const segmenter = createSegmenter();
  play(segmenter, ROOM, 1_000);
  const events = play(segmenter, ROOM, 4_000);
  check("steady room noise is not speech, however long it goes on", kinds(events), []);
}

{
  /* The case a fixed threshold gets wrong in the quiet direction: someone
     speaking softly in a silent room, well under 0.045. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 600);
  const started = play(segmenter, 0.02, 600);
  check("a quiet talker in a quiet room is heard", kinds(started).includes("speech-start"), true);
  check("which a fixed 0.045 threshold would have missed", 0.02 < 0.045, true);
}

{
  /* And the case it gets wrong in the loud direction: a room whose own noise
     is above the fixed threshold, where every second would be transcribed. */
  const segmenter = createSegmenter();
  play(segmenter, 0.06, 2_000);
  const noise = play(segmenter, 0.06, 3_000);
  check("a loud room raises the bar rather than transcribing itself", kinds(noise), []);
  check("which a fixed 0.045 threshold would have called speech", 0.06 > 0.045, true);
  const spoken = play(segmenter, 0.3, 600);
  check("and speech over that room is still heard", kinds(spoken).includes("speech-start"), true);
}

{
  /* The failure that would make dictation unusable: cutting in while someone
     is thinking. People pause 200–500ms between clauses as a matter of course. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 400);
  play(segmenter, SPEECH, 1_200);
  const gap = play(segmenter, QUIET, 400);
  check("a 400ms clause gap does not close a segment", segmentsIn(gap).length, 0);
  check("and does not even count as the end of speech", kinds(gap).includes("speech-end"), false);

  play(segmenter, SPEECH, 800);
  const stopped = play(segmenter, QUIET, 1_500);
  const cuts = segmentsIn(stopped);
  check("but stopping does close it", cuts.length, 1);
  check("as a natural pause rather than a forced cut", cuts[0]?.boundary, "pause");
  check("and speech is reported as over", kinds(stopped).includes("speech-end"), true);
}

{
  /* The clipped-first-consonant bug. A detector needs evidence and gathering
     it takes time, so by the moment it is sure, the word has already started.
     Without pre-roll every utterance loses its opening sound — "sat" for
     "that" — which reads as a poor transcriber rather than a cut recording. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 1_000);       // 50 hops of room
  play(segmenter, SPEECH, 600);
  const cuts = segmentsIn(play(segmenter, QUIET, 1_200));
  check("one segment", cuts.length, 1);
  /* Speech began at hop 50. The segment must begin before that, by at least
     the pre-roll window. */
  check("the segment starts before the speech did", cuts[0].startHop < 50, true);
  check("by at least 300ms of it", 50 - cuts[0].startHop >= 15, true);
}

{
  /* Trailing silence is trimmed rather than kept. Whisper is known to invent
     text over long silences, and a segment ending in a second of nothing is
     the most reliable way to be handed a sentence nobody said. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 400);
  play(segmenter, SPEECH, 1_000);      // speech ends at hop 70
  const cuts = segmentsIn(play(segmenter, QUIET, 3_000));
  check("the segment ends shortly after the speech, not at the end of the silence", cuts[0].endHop < 90, true);
  check("but not before it", cuts[0].endHop > 70, true);
}

{
  /* A door, a chair, a tap on the phone. Three hops is enough to open a
     segment, on purpose — waiting longer would clip real speech — so the
     guard against uploading a click is on the way out rather than on the way
     in. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 500);
  play(segmenter, 0.4, 60);
  const cuts = segmentsIn(play(segmenter, QUIET, 1_500));
  check("a 60ms click opens nothing worth sending", cuts.length, 0);
}

{
  /* A sentence that runs past the ceiling has to be cut somewhere, and the
     only question is where. Cutting at the ceiling itself lands mid-syllable
     about as often as not; cutting at the quietest recent moment lands
     between words nearly always. */
  const segmenter = createSegmenter({ maxSegmentMs: 2_000, splitSearchMs: 600, splitOverlapMs: 100 });
  play(segmenter, QUIET, 200);          // hops 0-9
  play(segmenter, SPEECH, 1_400);       // hops 10-79
  play(segmenter, 0.04, 60);            // hops 80-82: the gap between two words
  const events = play(segmenter, SPEECH, 600);
  const cuts = segmentsIn(events);

  check("the sentence is cut rather than growing without bound", cuts.length, 1);
  check("and the cut is marked as forced", cuts[0].boundary, "split");
  check("placed at the quiet moment, not at the ceiling", cuts[0].endHop >= 80 && cuts[0].endHop <= 83, true);
  check("and speech is never reported as having stopped", kinds(events).includes("speech-end"), false);
}

{
  /* The other half of a forced cut: the next segment starts *before* it, so a
     word straddling the boundary is recorded twice rather than lost. Losing it
     is silent and unrecoverable; recording it twice is visible and can be
     reconciled in text. */
  const segmenter = createSegmenter({ maxSegmentMs: 2_000, splitSearchMs: 600, splitOverlapMs: 100 });
  play(segmenter, QUIET, 200);
  play(segmenter, SPEECH, 1_400);
  play(segmenter, 0.04, 60);
  const first = segmentsIn(play(segmenter, SPEECH, 600))[0];
  const second = segmentsIn(play(segmenter, QUIET, 1_500))[0];
  check("a second segment follows", Boolean(second), true);
  check("and it begins before the first one ended", second.startHop < first.endHop, true);
  check("by the overlap that was asked for", first.endHop - second.startHop, 5);
}

{
  /* Everything still open when the recording stops has to come out, including
     the tail of a sentence that was mid-word when Stop was pressed. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 300);
  play(segmenter, SPEECH, 1_000);
  const flushed = segmenter.flush();
  check("stopping mid-sentence still yields the sentence", segmentsIn(flushed).length, 1);
  check("and reports that speech ended", kinds(flushed).includes("speech-end"), true);
  check("flushing twice does not yield it twice", segmentsIn(segmenter.flush()).length, 0);
}

{
  /* Memory. The old recorder held the entire take, which is the other half of
     why it needed a sixty-second cap. Nothing is held now but the open segment
     and the pre-roll — so an hour of silence costs the same as a second of it. */
  const segmenter = createSegmenter();
  play(segmenter, QUIET, 30_000);
  const idle = segmenter.state().hop - segmenter.retainFromHop();
  check("an idle microphone holds only the pre-roll", idle < 30, true);

  play(segmenter, SPEECH, 3_000);
  const open = segmenter.state().hop - segmenter.retainFromHop();
  check("an open segment holds all of itself", open > 140, true);
}

/* ── Ending a turn without a button (hands-free) ──────────────────────────── */

{
  const segmenter = createSegmenter({ endAfterSilenceMs: 1_100, noSpeechMs: 6_000 });
  play(segmenter, QUIET, 300);
  play(segmenter, SPEECH, 1_000);
  const ended = play(segmenter, QUIET, 2_000).find((event) => event.type === "turn-end");
  check("a turn ends on the pause after speech", ended?.type === "turn-end" && ended.reason, "spoke");
}

{
  const segmenter = createSegmenter({ endAfterSilenceMs: 1_100, noSpeechMs: 6_000 });
  const events = play(segmenter, QUIET, 10_000);
  const ended = events.find((event) => event.type === "turn-end");
  /* Reported as "silent" rather than "spoke" so the caller can discard the
     turn instead of paying to transcribe six seconds of nothing. */
  check("an open microphone in an empty room gives up", ended?.type === "turn-end" && ended.reason, "silent");
  check("and it did not wait the full ten seconds", segmenter.state().hop < 350, true);
  check("nothing having been heard", segmenter.state().heardSpeech, false);
}

{
  const segmenter = createSegmenter({ maxRecordingMs: 2_000 });
  const ended = play(segmenter, SPEECH, 10_000).find((event) => event.type === "turn-end");
  check("a recording that never stops is cut at the ceiling", ended?.type === "turn-end" && ended.reason, "too-long");
  check("at the ceiling rather than long after it", segmenter.state().hop <= 101, true);
}

{
  /* The level callback keeps arriving after a turn ends — the recorder does
     not know yet — and a second ending would open a second recorder. */
  const segmenter = createSegmenter({ endAfterSilenceMs: 1_100, noSpeechMs: 2_000 });
  const first = play(segmenter, QUIET, 5_000).filter((event) => event.type === "turn-end");
  check("the turn ends once", first.length, 1);
  check("and nothing is reported after it", play(segmenter, QUIET, 5_000).length, 0);
  segmenter.reset();
  check("until it is reset", play(segmenter, QUIET, 5_000).filter((event) => event.type === "turn-end").length, 1);
}

/* ── Reconciling a forced cut in text ─────────────────────────────────────── */

{
  check("an overlap is not repeated",
    mergeSplitTranscripts("the quick brown fox", "brown fox jumps over"),
    "the quick brown fox jumps over");
  check("case and punctuation do not hide it",
    mergeSplitTranscripts("we should meet on Tuesday,", "on tuesday at four"),
    "we should meet on Tuesday, at four");
  /* One matching word is very often a genuine repetition, and deleting it
     would be deleting something that was said. */
  check("a single repeated word is left alone",
    mergeSplitTranscripts("no", "no I meant the other one"),
    "no no I meant the other one");
  check("unrelated pieces are simply joined",
    mergeSplitTranscripts("first part", "second part"),
    "first part second part");
  check("an empty piece contributes nothing", mergeSplitTranscripts("only this", "   "), "only this");
  check("and an empty start is not padded", mergeSplitTranscripts("", "just this"), "just this");
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
