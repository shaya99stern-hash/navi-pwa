import { createTurnDetector } from "@/lib/ui/conversation";

/**
 * Knowing when someone has stopped talking.
 *
 * Voice mode was four deliberate acts per turn — speak, Stop, read, Send —
 * three of them needing a hand and eyes, which is the whole thing you are
 * trying to avoid by talking to something. Continuous listening removes all
 * four, and needs exactly one thing the Stop button used to supply: the fact
 * that the turn is over.
 *
 * Every failure mode here is a timing bug, on a phone, mid-sentence, and none
 * of them can be found by looking. So the detector takes `now` as an argument
 * and these feed it the shapes that actually occur.
 */

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/** Feed a level for a stretch of time, 50ms a sample, and report any ending. */
function play(detector: ReturnType<typeof createTurnDetector>, level: number, ms: number, from: number) {
  let now = from;
  const until = from + ms;
  while (now < until) {
    const ended = detector.push(level, now);
    if (ended) return { ended, at: now };
    now += 50;
  }
  return { ended: null, at: now };
}

const QUIET = 0.01;   // a room with a fan in it
const SPEECH = 0.18;  // ordinary speech at arm's length

/* ── A pause between clauses is not the end of a turn ────────────────────── */

/* The failure that would make this unusable: cutting in while someone is
   thinking. People pause 200-500ms between clauses routinely. */
{
  const detector = createTurnDetector();
  let t = 1_000;
  detector.reset(t);
  ({ at: t } = play(detector, SPEECH, 1_200, t));
  const pause = play(detector, QUIET, 400, t);
  check("a 400ms clause gap does not end the turn", pause.ended, null);
  t = pause.at;
  const resumed = play(detector, SPEECH, 800, t);
  check("and speech resumes cleanly", resumed.ended, null);
  t = resumed.at;
  /* The real end. Past the clause gap, inside the patience of someone waiting. */
  const ended = play(detector, QUIET, 1_500, t);
  check("but a real stop does end it", ended.ended, "spoke");
}

/* ── An open microphone in an empty room does not hang ───────────────────── */

{
  const detector = createTurnDetector();
  detector.reset(0);
  const ended = play(detector, QUIET, 10_000, 0);
  /* Reported as "silent" rather than "spoke" so the caller can throw the clip
     away instead of paying to transcribe six seconds of nothing. */
  check("silence with no speech ends the turn as silent", ended.ended, "silent");
  check("and it did not wait the full ten seconds", ended.at < 7_000, true);
  check("nothing was heard", detector.heardSpeech(), false);
}

/* ── Room noise below the threshold is not speech ─────────────────────────── */

{
  const detector = createTurnDetector();
  detector.reset(0);
  /* The whole reason for a threshold rather than "any signal": a laptop fan is
     never zero, and a detector triggered by it would transcribe the room. */
  const ended = play(detector, 0.03, 8_000, 0);
  check("steady room noise never counts as speech", ended.ended, "silent");
  check("so no clip is sent", detector.heardSpeech(), false);
}

/* ── A quiet talker still registers ──────────────────────────────────────── */

{
  const detector = createTurnDetector();
  detector.reset(0);
  const spoke = play(detector, 0.06, 1_000, 0);
  check("speech just above the floor is heard", detector.heardSpeech(), true);
  check("and does not end while it continues", spoke.ended, null);
  check("then ends on the pause", play(detector, QUIET, 1_500, spoke.at).ended, "spoke");
}

/* ── A turn that never stops is cut off ──────────────────────────────────── */

{
  /* The transcriber has its own ceiling on clip length, and a turn reaching
     this has almost certainly been left open in a noisy room. */
  const detector = createTurnDetector({ maxTurnMs: 3_000 });
  detector.reset(0);
  const ended = play(detector, SPEECH, 10_000, 0);
  check("continuous speech is cut at the ceiling", ended.ended, "too-long");
  check("at the ceiling rather than after it", ended.at < 3_200, true);
}

/* ── It ends once ────────────────────────────────────────────────────────── */

{
  /* The level callback keeps firing after the turn ends — the recorder does
     not know yet — and a second ending would open a second recorder. */
  const detector = createTurnDetector();
  detector.reset(0);
  const first = play(detector, QUIET, 8_000, 0);
  check("the first ending is reported", first.ended, "silent");
  check("and nothing is reported after it", play(detector, QUIET, 8_000, first.at).ended, null);
  check("until it is reset", (() => {
    detector.reset(20_000);
    return play(detector, QUIET, 8_000, 20_000).ended;
  })(), "silent");
}

/* ── Reset clears what was heard ─────────────────────────────────────────── */

{
  const detector = createTurnDetector();
  detector.reset(0);
  play(detector, SPEECH, 500, 0);
  check("speech was heard", detector.heardSpeech(), true);
  detector.reset(10_000);
  check("and reset forgets it, so the next turn starts clean", detector.heardSpeech(), false);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
