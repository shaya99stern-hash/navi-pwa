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
/* Recognition streamed words as they were spoken; recording can only produce
   them at the end. An empty panel across that gap reads as the recording
   having been thrown away, so the wait is shown. */
check("the sheet shows the wait for the transcript", sheet.body.includes("transcribing"), true);
check("it says what is happening", sheet.source.includes("Writing down what you said"), true);
/* Start / Stop / Start again is how a long thought gets spoken. */
check("a second pass adds to the turn", /setTranscript\(\(current\) => `\$\{current\}/.test(sheet.body), true);
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

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
