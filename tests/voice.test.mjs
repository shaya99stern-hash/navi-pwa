import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* One voice mode. There were two independent recognisers — the composer's
   press-and-hold mic and the voice sheet — and every difference between them
   was a defect nobody could see from inside either file. */

const speech = read("lib/ui/speech.ts");
const composer = read("app/components/composer-dock.tsx");
const sheet = read("app/components/voice-mode-sheet.tsx");
const shell = read("app/components/app-shell.tsx");
const settings = read("app/components/settings-sheet.tsx");

/* ---- There is no recogniser left ------------------------------------- */

/* `webkitSpeechRecognition` is gone from the app entirely.
 *
 * It was the cause, not a symptom: in an installed iOS PWA it is frequently
 * absent with no error and no event to render, it plays a system chime the
 * page cannot suppress, and it ends sessions in ways nothing can observe.
 * Every fix layered on top of it was a fix on sand — restart-on-end, fatal
 * error sets, interim filtering, all of it working around a foundation that
 * does not hold.
 *
 * The composer moved to recording plus transcription first and the voice sheet
 * was left behind, which was worse than either answer alone: the microphone
 * worked or did not depending on which button was pressed. Now neither uses
 * it, and the implementation is deleted rather than left for something to
 * reach for again. */
check("the module no longer constructs one", speech.source.includes("webkitSpeechRecognition"), false);
check("the composer does not either", stripComments(composer.source).includes("webkitSpeechRecognition"), false);
check("nor the sheet", stripComments(sheet.source).includes("webkitSpeechRecognition"), false);
check("the recognition entry point is gone", speech.source.includes("startSpeechRecognition"), false);
/* Speech *synthesis* is a different API and still earns its place: it is what
   reads a reply aloud, and it works. */
check("speaking replies still works", speech.body.includes("SpeechSynthesisUtterance"), true);
check("and still picks a good voice", speech.body.includes("pickVoice"), true);
/* Neither surface uses speech recognition now. In an installed iOS PWA
   `webkitSpeechRecognition` is frequently absent with no error and no event to
   render, which is why the mic "did not work at all".

   The sheet was the last holdout, and leaving it there was worse than either
   answer alone: the microphone worked or did not depending on which button was
   pressed. Both record audio and have it transcribed. */
check("the composer records instead of recognising", composer.body.includes("startRecording"), true);
check("the composer does not use recognition", composer.body.includes("startSpeechRecognition"), false);
check("the sheet records too", sheet.body.includes("startRecording"), true);
check("the sheet does not use recognition either", sheet.body.includes("startSpeechRecognition"), false);
/* The one thing recognition did better has been recovered.
 *
 * It streamed words as they were spoken; the first recording version could
 * only produce them at the end, so this sheet had to show a spinner across
 * the whole gap — an empty panel there reads as the recording having been
 * thrown away. The recorder transcribes segment by segment while the
 * microphone is still open, so the text builds up as it is spoken and the
 * spinner now covers only the last unfinished sentence. */
check("the transcript arrives while it is being spoken", sheet.body.includes("onTranscript: setLive"), true);
check("the pass in flight is kept apart from the passes already finished",
  /const \[live, setLive\]/.test(sheet.body), true);
check("and shown as provisional until it settles", /listening \? "text-secondary" : undefined/.test(sheet.body), true);
check("the sheet still shows the wait for the last sentence", sheet.body.includes("transcribing"), true);
check("and says what is happening", sheet.source.includes("Writing down what you said"), true);
/* Start / Stop / Start again is how a long thought gets spoken. */
check("a second pass adds to the turn",
  /const merged = `\$\{current\}\$\{current\.trim\(\) \? " " : ""\}\$\{text\}`/.test(sheet.body), true);
/* Read from a ref, not from state. `stop()` runs inside the recorder's level
   callback, which closes over the render that started the recording — so
   appending to the state variable would append to a copy one turn stale. */
check("and reads the running transcript from a ref, not a stale closure",
  /const current = transcriptRef\.current;/.test(sheet.body), true);
check("with one writer keeping the ref and the state together",
  /function writeTranscript\(next: string\)/.test(sheet.body), true);
/* A recording left running holds the microphone and keeps the browser's
   recording indicator lit after the sheet is gone. */
check("closing the sheet releases the microphone", /recorderRef\.current\?\.cancel\(\)/.test(sheet.body), true);

/* ---- One language, from one place ------------------------------------ */

/* The composer used navigator.language while the sheet honoured the stored
   preference, so choosing Hebrew in Settings changed one surface and silently
   not the other. */
/* Transcription detects the spoken language itself, so the composer no longer
   needs the preference to be told to it — which removes a way for the two
   surfaces to disagree rather than adding one. */
check("the sheet takes the preference", sheet.body.includes("language: voiceLanguage"), true);
check("the shell passes it to the composer", shell.body.includes("voiceLanguage={preferences.voiceLanguage}"), true);
check("only the module resolves auto", /navigator\.language/.test(stripComments(composer.source)), false);
check("resolution lives in the module", speech.body.includes('preference === "auto"'), true);

/* The sheet kept a private copy in localStorage that Settings had to mirror
   into on every change. A second store is a second thing to forget. */
const legacyKey = "navi.voice.language.v1";
check("the sheet keeps no private copy", sheet.source.includes(legacyKey), false);
check("settings writes no mirror", stripComments(settings.source).includes(legacyKey), false);
/* Reading the legacy key for the reply voice meant an answer could be spoken
   in a different language from the one the question was dictated in. */
check("the spoken reply uses the preference", shell.body.includes("resolveVoiceLanguage(preferences.voiceLanguage)"), true);
check("nothing outside storage reads the legacy key", stripComments(shell.source).includes(legacyKey), false);
/* Storage may still read it: that is the one-time migration into preferences. */
check("the migration still reads it", read("lib/storage/indexeddb.ts").body.includes(legacyKey), true);

/* ---- Interim results are not draft text ------------------------------ */

/* The composer appended on every result event without checking isFinal, so
   interim words landed in the draft and landed again once revised. The whole
   category is gone with recognition: transcription returns one settled string,
   so there is no half-formed text to leak anywhere. */
/* Transcription returns one settled string, so there is no interim text to
   leak into the draft — the class of bug this guarded cannot occur on either
   surface any more. */
check("neither surface tracks interim text", sheet.body.includes("setInterim") || composer.body.includes("setInterim"), false);
/* And appends to the draft as it stands now, not as it stood when listening
   began — a callback closes over the value from that render. */
check("the composer reads the live draft", composer.body.includes("valueRef.current"), true);

/* ---- A blocked microphone is not a retry ----------------------------- */

/* The distinction moved with the implementation: it used to be a switch over
   recognition error codes, and now it is what `startRecording` throws. What
   must not change is that a refused permission and a missing microphone are
   different problems with different remedies, and neither is described as
   though waiting would help. */
const recorderSource = read("lib/ui/recorder.ts");

check("permission denial is told apart", /NotAllowedError|SecurityError/.test(recorderSource.body), true);
check("it says where to fix it", /Microphone access was refused/.test(recorderSource.body), true);
check("it does not invite a retry", /Microphone access was refused[^"]*[Tt]ry again/.test(recorderSource.body), false);
check("a missing microphone says so instead", /No microphone is available/.test(recorderSource.body), true);
/* Both surfaces show what was thrown rather than a generic line of their own,
   which is what makes the distinction reach the person. */
check("the sheet surfaces the real reason", /caught instanceof Error \? caught\.message/.test(sheet.body), true);
check("the composer does too", /error instanceof Error \? error\.message/.test(composer.body), true);
/* Silence after a recording is not a failure of the microphone, and saying
   "that could not be transcribed" for it sends someone to the wrong problem. */
check("silence is reported as silence", /Nothing was picked up/.test(sheet.source), true);

/* ---- The sheet behaves like the other bottom sheets ------------------- */

/* It was the one bottom sheet without drag-to-dismiss: same shape, same
   position, and the swipe that closed every other one did nothing here. An
   affordance that works everywhere except one place is worse than one that
   works nowhere, because nothing tells you which place you are in. */
check("the sheet can be swiped away", sheet.body.includes("useSheetDrag"), true);
check("the scrim fades with the drag", /sheet\.scrimProps/.test(sheet.body), true);
check("only the grab area starts a drag", /sheet\.handleProps/.test(sheet.body), true);
/* A second way out that skips the cleanup is a microphone left open. */
check("a swipe goes through the same cleanup", /onDismiss: \(\) => resetAndClose\(\)/.test(sheet.body), true);
/* Two controls sharing one name is ambiguous to a screen reader and to a test. */
check("the scrim and the X are named apart", (sheet.source.match(/aria-label="Close voice mode"/g) ?? []).length, 1);

/* ---- The language picker reaches the transcriber ---------------------- */

/* Voice mode has offered a dictation-language picker all along and nothing
   ever sent it anywhere: it wrote a stored preference and changed nothing
   else. Whisper detects the language itself, but detection is what fails on a
   short clip or a bilingual speaker — exactly the person who went looking for
   the setting. */
const route = read("app/api/voice/transcribe/route.ts");

check("the recorder accepts a language", /language\?: string;/.test(recorderSource.body), true);
check("it travels with the recording", /language=\$\{encodeURIComponent\(language\)\}/.test(recorderSource.body), true);
/* "auto" is the absence of a hint, not a default of English. */
check("auto sends no hint", /language && language !== "auto"/.test(recorderSource.body), true);
check("the sheet passes the stored preference", /language: voiceLanguage/.test(sheet.body), true);
check("the composer passes the same one", /language: voiceLanguage/.test(composer.body), true);
check("the route forwards it to the model", /form\.append\("language", language\)/.test(route.body), true);
/* A bare subtag is what the API takes: `he`, not `he-IL`. And an unvalidated
   query parameter has no business reaching a provider verbatim. */
check("the tag is validated before use", /\^\[a-z\]\{2\}/.test(route.body), true);
check("only the primary subtag is sent", /requested\.split\("-"\)\[0\]\.toLowerCase\(\)/.test(route.body), true);

/* ── Hands-free ──────────────────────────────────────────────────────────
   The dictation flow is four deliberate acts per turn — speak, Stop, read,
   Send — three of them needing a hand and eyes, which is the entire thing you
   are trying to avoid by talking to something. */

check("the sheet can run hands-free", /const \[conversation, setConversation\]/.test(sheet.body), true);
/* Off by default. Holding the microphone open across a whole exchange is not
   something to start on someone's behalf. */
check("and it is off until asked for", /useState\(false\);/.test(sheet.body), true);
/* Detected by the recorder, which is the one place that knows. This sheet
   used to run a second detector of its own over the level meter, with a fixed
   threshold — so hands-free worked in a quiet room and nowhere else, while the
   recorder was separately deciding, against a measured noise floor, where
   speech began and ended. Two answers to one question is how two surfaces
   drift apart, and the level-meter one was the worse answer. */
check("the end of a turn is detected rather than pressed",
  /handsFree: conversation/.test(sheet.body), true);
check("by the detector that also decides where segments are cut",
  /onAutoStop: \(reason: AutoStopReason\)/.test(sheet.body), true);
check("and the sheet keeps no second detector of its own",
  stripComments(sheet.source).includes("createTurnDetector"), false);
/* Hands-free is decided when the recorder is opened, so a switch flipped
   mid-turn has to restart it — otherwise turning it on looks like it did
   nothing until the turn after next. */
check("flipping the switch mid-turn restarts rather than doing nothing",
  /if \(listening\) void stop\(\{ discard: true \}\);/.test(sheet.body), true);
check("and the turn is sent without a review step",
  /if \(conversation && online && !busy\) send\(merged\);/.test(sheet.body), true);

/* The failure that would make it unusable: opening the microphone while the
   reply is still playing out of the speaker, transcribing it, and sending it
   back as the next question. */
check("listening waits for the request to finish",
  /if \(busy \|\| reading \|\| listening \|\| transcribing \|\| restarting\.current\) return;/.test(sheet.body), true);
check("and for the reply to stop being spoken",
  /setReading\(window\.speechSynthesis\.speaking\)/.test(sheet.body), true);
/* Two different things were both called `speaking`: the app reading a reply
   aloud, and the detector hearing a voice. Hands-free is the feature that
   depends on telling them apart — confusing them is the app transcribing its
   own voice back as the next question — so they are named apart. */
check("the app talking and the person talking are named apart",
  /const \[reading, setReading\]/.test(sheet.body) && /const \[speaking, setSpeaking\]/.test(sheet.body), true);
check("with a beat before reopening, so the speaker's tail is not the next turn",
  /}, 450\);/.test(sheet.body), true);
/* busy, speaking and listening settle at different moments; without the guard
   one gap opens two recorders. */
check("a guard stops two recorders opening on one gap",
  /const restarting = useRef\(false\);/.test(sheet.body), true);

/* A turn with no words in it costs a transcription and returns nothing. */
check("a silent turn is discarded rather than transcribed",
  /if \(reason === "silent"\) void stop\(\{ discard: true \}\);/.test(sheet.body), true);
/* Saying "nothing was picked up" every few seconds, hands-free, is its own
   kind of broken. */
check("and it does not nag about it while hands-free",
  /if \(!conversation\) setError\("Nothing was picked up/.test(sheet.body), true);

/* A hands-free conversation with a silent partner is not a conversation. */
check("turning it on turns on reading the reply aloud",
  /if \(next\) setSpeakReply\(true\);/.test(sheet.body), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
