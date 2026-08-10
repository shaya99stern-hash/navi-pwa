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

/* ---- There is exactly one recogniser -------------------------------- */

check("the module owns the constructor lookup", speech.body.includes("webkitSpeechRecognition"), true);
/* The check that keeps this true. Either surface reaching for the global again
   is how the two copies came apart in the first place. */
check("the composer does not construct its own", stripComments(composer.source).includes("webkitSpeechRecognition"), false);
check("the sheet does not construct its own", stripComments(sheet.source).includes("webkitSpeechRecognition"), false);
/* The composer no longer uses speech recognition at all. In an installed iOS
   PWA `webkitSpeechRecognition` is frequently absent with no error and no
   event to render, which is why the mic "did not work at all" — it recorded
   audio and had it transcribed instead. The voice sheet is a live
   conversation surface and still uses recognition, so the rule that only the
   module may construct one still matters. */
check("the composer records instead of recognising", composer.body.includes("startRecording"), true);
check("the composer does not use recognition", composer.body.includes("startSpeechRecognition"), false);
check("the sheet uses the shared one", sheet.body.includes("startSpeechRecognition"), true);

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
   interim words landed in the draft and landed again once revised. */
check("the module separates final from interim", speech.body.includes("result?.isFinal"), true);
check("only final text is offered for appending", /if \(final\.trim\(\)\) options\.onFinal/.test(speech.body), true);
/* Transcription returns one settled string, so there is no interim text to
   leak into the draft — the class of bug this guarded cannot occur in the
   composer any more. The rule still binds the sheet, which streams. */
check("the sheet appends only finals", sheet.body.includes("onFinal"), true);
/* And appends to the draft as it stands now, not as it stood when listening
   began — a callback closes over the value from that render. */
check("the composer reads the live draft", composer.body.includes("valueRef.current"), true);

/* ---- A blocked microphone is not a retry ----------------------------- */

check("permission denial is recognised", speech.body.includes('case "not-allowed"'), true);
check("it says where to fix it", /Microphone access is off/.test(speech.body), true);
check("it does not invite a retry", /Microphone access is off[^"]*Try again/.test(speech.body), false);
/* A deliberate abort is not a failure and deserves no message. */
check("an abort is silent", /case "aborted":\s*\n\s*return "";/.test(speech.body), true);
check("the caller suppresses empty messages", speech.body.includes("if (message) options.onError?.(message)"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
