import { existsSync } from "node:fs";
import { join } from "node:path";
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
const loop = read("lib/ui/voice-conversation.ts");
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
check("nor the conversation loop", loop.code.includes("webkitSpeechRecognition"), false);
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
check("the conversation records instead of recognising", loop.body.includes("startRecording"), true);
/* And the composer holds no recorder of its own any more. The dictation mic
   that used to sit beside the conversation button was a second microphone a
   thumb apart from the first, drawn the same way and doing something else. */
check("the composer holds no recorder of its own", composer.body.includes("startRecording"), false);
check("the composer does not use recognition", composer.body.includes("startSpeechRecognition"), false);
check("and does not use recognition either", loop.body.includes("startSpeechRecognition"), false);
/* The one thing recognition did better has been recovered.
 *
 * It streamed words as they were spoken; the first recording version could
 * only produce them at the end, so this sheet had to show a spinner across
 * the whole gap — an empty panel there reads as the recording having been
 * thrown away. The recorder transcribes segment by segment while the
 * microphone is still open, so the text builds up as it is spoken and the
 * spinner now covers only the last unfinished sentence. */
check("the transcript arrives while it is being spoken", loop.body.includes("onTranscript: setTranscript"), true);
check("and reaches the box the words would have been typed into",
  /previewValue = talking\s*\?\s*conversation\.transcript/.test(composer.body), true);
/* Every phase gets a line, including the ones that pass in under a second.
   A screen that goes blank between the pause and the answer cannot be told
   apart from one that has stopped working. */
check("each phase says what is happening", /CONVERSATION_PLACEHOLDER: Record<VoiceConversation\["phase"\], string>/.test(composer.body), true);
for (const phase of ["listening", "transcribing", "thinking", "speaking"]) {
  check(`including ${phase}`, new RegExp(`  ${phase}: "[^"]+"`).test(composer.body), true);
}
/* The turn is sent when the pause lands, so its words never become draft
   text — which is what makes them disappear on their own afterwards. */
check("a spoken turn does not leak into the draft", /setTranscript\(""\)/.test(loop.body), true);
/* A recording or a reply left running holds the microphone and keeps the
   browser's recording indicator lit after the conversation is over. */
check("ending the conversation releases the microphone", /session\?\.cancel\(\);/.test(loop.body), true);
check("and silences the reply that was still playing", /spoken\?\.stop\(\);/.test(loop.body), true);
/* Cleared before cancelled, not after. Cancelling ends the recorder's own turn
   detection, and a callback firing on the way out would otherwise find a
   session still in the ref and transcribe the recording just thrown away. */
check("with the reference dropped before the thing it points at is torn down",
  loop.body.indexOf("recorderRef.current = null;\n    session?.cancel();") > -1, true);
/* Three callers do this — the stop button, unmount, and a failure that ends
   the conversation. Three near-copies is how a microphone gets left on. */
check("through one release path rather than three near-copies",
  (loop.body.match(/const release = useCallback/g) ?? []).length, 1);

/* ---- One language, from one place ------------------------------------ */

/* The composer used navigator.language while the sheet honoured the stored
   preference, so choosing Hebrew in Settings changed one surface and silently
   not the other. */
/* Transcription detects the spoken language itself, so the composer no longer
   needs the preference to be told to it — which removes a way for the two
   surfaces to disagree rather than adding one. */
check("the conversation takes the preference", /const \{ online, language \} = optionsRef\.current;/.test(loop.body), true);
/* To the message row, which reads a reply aloud. The composer used to take a
   copy for its own recorder; it has none, so this is now the only place the
   preference is handed down for speech. */
check("the shell passes it to what speaks", shell.body.includes("voiceLanguage={preferences.voiceLanguage}"), true);
check("only the module resolves auto", /navigator\.language/.test(stripComments(composer.source)), false);
check("resolution lives in the module", speech.body.includes('preference === "auto"'), true);

/* The sheet kept a private copy in localStorage that Settings had to mirror
   into on every change. A second store is a second thing to forget. */
const legacyKey = "navi.voice.language.v1";
check("the conversation keeps no private copy", loop.source.includes(legacyKey), false);
check("settings writes no mirror", stripComments(settings.source).includes(legacyKey), false);
/* Reading the legacy key for the reply voice meant an answer could be spoken
   in a different language from the one the question was dictated in. */
check("the shell hands the loop the stored preference",
  /language: preferences\.voiceLanguage,/.test(shell.body), true);
check("and the spoken reply resolves it there",
  /resolveVoiceLanguage\(optionsRef\.current\.language\)/.test(loop.body), true);
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
check("neither surface tracks interim text", loop.body.includes("setInterim") || composer.body.includes("setInterim"), false);
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
check("the conversation surfaces the real reason", /caught instanceof Error \? caught\.message/.test(loop.body), true);
/* One surface now, so one assertion. The composer's own copy of this went
   with the dictation path. */
/* Silence is not a failure of the microphone. The loop's answer is better
   than a message: it simply reopens the microphone, because in a conversation
   a pause is a pause. */
check("silence reopens the microphone", /if \(!text\) \{ relisten\(\); return; \}/.test(loop.body), true);

/* ---- There is no sheet ------------------------------------------------ */

/* Voice mode was a modal with five controls in it — Start, Stop, Send, a
   hands-free switch and a read-aloud switch — between wanting to say something
   and having said it. Four of those five were answering questions the loop can
   answer for itself, and the fifth duplicated a setting Settings already owns.
   The file is deleted rather than left unreferenced, because an orphaned
   component is the thing the next change reaches for. */
check("the sheet component is gone", existsSync(join(process.cwd(), "app/components/voice-mode-sheet.tsx")), false);
check("nothing imports it", /voice-mode-sheet/.test(shell.source) || /voice-mode-sheet/.test(composer.source), false);
/* The composer no longer opens anything: the button is the feature. */
check("one tap on the composer starts the conversation",
  /onClick=\{conversation\.toggle\}/.test(composer.body), true);
check("and there is no sheet left for it to open", /onOpenVoice/.test(composer.source), false);
/* Two microphones open at once fought over the device and transcribed the
   same sentence twice, which each control used to guard against by disabling
   the other's. There is one now, which is a better answer than a guard: the
   condition cannot arise. */
check("there is exactly one microphone in the composer",
  (composer.body.match(/aria-label="Start a voice conversation"/g) ?? []).length, 1);
check("and nothing else in the composer opens one", /aria-label="Record a message"/.test(composer.body), false);
check("the conversation claims the composer row while it runs",
  /\{talking \? \(\s*<span/.test(composer.body), true);
/* The way out is inside the strip, where the thing to stop is. */
check("the conversation can be ended from where it is shown",
  /onClick=\{conversation\.stop\}/.test(composer.body), true);
/* The language picker is not reproduced here: Settings owns that preference,
   and two pickers meant the answer depended on which screen you last opened. */
check("settings still owns the dictation language",
  /onChange=\{\(voiceLanguage\) => update\(\{ voiceLanguage \}\)\}/.test(settings.body), true);

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
check("the conversation passes the stored preference", /\n        language,/.test(loop.body), true);
/* The composer used to pass it too, for its own recorder. It has none now,
   so the preference reaches the recorder by exactly one path. */
check("nothing else passes a language", /language: voiceLanguage/.test(composer.body), false);
check("the route forwards it to the model", /form\.append\("language", language\)/.test(route.body), true);
/* A bare subtag is what the API takes: `he`, not `he-IL`. And an unvalidated
   query parameter has no business reaching a provider verbatim. */
check("the tag is validated before use", /\^\[a-z\]\{2\}/.test(route.body), true);
check("only the primary subtag is sent", /requested\.split\("-"\)\[0\]\.toLowerCase\(\)/.test(route.body), true);

/* ── Hands-free ──────────────────────────────────────────────────────────
   The dictation flow is four deliberate acts per turn — speak, Stop, read,
   Send — three of them needing a hand and eyes, which is the entire thing you
   are trying to avoid by talking to something. */

/* Hands-free is not a switch any more, it is what the mode is. The recorder is
   opened one way and only one way. */
check("the microphone always ends its own turn", /handsFree: true,/.test(loop.body), true);
/* Detected by the recorder, which is the one place that knows. The sheet used
   to run a second detector of its own over the level meter, with a fixed
   threshold — so hands-free worked in a quiet room and nowhere else, while the
   recorder was separately deciding, against a measured noise floor, where
   speech began and ended. Two answers to one question is how two surfaces
   drift apart, and the level-meter one was the worse answer. */
check("by the detector that also decides where segments are cut",
  /onAutoStop: \(reason: AutoStopReason\)/.test(loop.body), true);
check("and the loop keeps no second detector of its own",
  loop.code.includes("createTurnDetector"), false);
check("the turn is sent without a review step", /onTurn\(text\);/.test(loop.body), true);

/* ── Half-duplex, and the arithmetic that enforces it ──────────────────────
   The failure that would make this unusable: opening the microphone while the
   reply is still playing out of the phone speaker, transcribing it, and
   sending it back as the next question. The previous version polled
   `speechSynthesis.speaking` for that, which is false for the entire duration
   of premium audio — so with an ElevenLabs key configured the guard was not
   merely weak, it was absent. */
check("the microphone reopens only after the audio has actually finished",
  /await handle\.done;/.test(loop.body), true);
check("which is the one signal that means the same thing for both voices",
  /const handle = await speakBest\(/.test(loop.body), true);
/* Two different things were both called `speaking`: the app reading a reply
   aloud, and the detector hearing a voice. This loop depends on telling them
   apart, so they are named apart — `phase` for what the app is doing,
   `hearing` for what the microphone is picking up. */
check("the app talking and the person talking are named apart",
  /const \[hearing, setHearing\]/.test(loop.body) && /"speaking"/.test(loop.body), true);
check("with a beat before reopening, so the speaker's tail is not the next turn",
  /const REOPEN_DELAY_MS = \d+;/.test(loop.body), true);
check("and reopening goes through that one delay rather than several",
  (loop.body.match(/REOPEN_DELAY_MS/g) ?? []).length, 2);
/* Reopening is attempted from the auto-stop callback, from the speech ending,
   and from the watchdog; without the guard one gap opens two recorders. */
check("a guard stops two recorders opening on one gap",
  /if \(!activeRef\.current \|\| recorderRef\.current\) return;/.test(loop.body), true);

/* A turn with no words in it costs a transcription and returns nothing. */
check("a silent turn is discarded rather than transcribed",
  /discard: reason === "silent"/.test(loop.body), true);
/* Saying "nothing was picked up" every few seconds is its own kind of broken,
   so an empty turn simply opens the next one. */
check("and it does not nag about it", /if \(!text\) \{ relisten\(\); return; \}/.test(loop.body), true);

/* ── The tap is spent on the thing that has to speak later ─────────────────
   iOS grants playback to an element inside a gesture, and every reply after
   the first arrives without one — the audio is a consequence of speaking
   rather than of touching anything. A `new Audio()` per utterance is therefore
   audible exactly once, which is a conversation that answers the first
   question aloud and then goes silent. */
check("starting the conversation primes audio playback", /primeSpeech\(\);/.test(loop.body), true);
check("the primer is a real clip rather than an empty header",
  /data:audio\/wav;base64,/.test(speech.body), true);
check("and every utterance reuses the element the tap unlocked",
  /const audio = audioElement\(\);/.test(speech.body), true);
/* A reused element that accumulates listeners settles every previous
   utterance's promise when this one ends, which unblocks a microphone that
   should still be shut. */
check("its listeners are taken away again on the way out",
  /stopListening\.abort\(\)/.test(speech.body), true);

/* ── Nothing leaves the loop waiting forever ─────────────────────────────── */

/* A send that failed before it started produces no reply and no error the loop
   can see. Without this it waits with the microphone shut and the screen
   saying "thinking" until someone taps out. Armed only while nothing is in
   flight, so a genuinely slow answer cannot trip it. */
check("an unanswered turn reopens the microphone rather than stalling",
  /if \(!active \|\| options\.busy \|\| phase !== "thinking"\) return;/.test(loop.body), true);
check("on a bounded wait", /const UNANSWERED_MS = \d+_?\d*;/.test(loop.body), true);
/* Going offline mid-conversation ends it rather than holding a microphone open
   against a connection that cannot carry the audio anywhere. */
check("going offline ends the conversation", /if \(active && !options\.online\) stop\(\);/.test(loop.body), true);
/* An answer that arrives after the conversation was closed must not start
   playing with nothing left holding a reference to silence it. */
check("a reply that lands after the end is not played",
  /if \(cancelled \|\| !activeRef\.current\) \{ handle\.stop\(\); return; \}/.test(loop.body), true);
/* Opening a conversation in a thread that already has answers in it must not
   begin by reading the last one aloud. */
check("it opens by listening, not by reading the thread back",
  /answeredRef\.current = optionsRef\.current\.reply\?\.id \?\? null;/.test(loop.body), true);
/* Half a sentence spoken and then a microphone opened over the rest of it. */
check("and never speaks an answer that is still streaming",
  /if \(generating\) return null;/.test(shell.body), true);

/* ── Writing for an ear, wired end to end ───────────────────────────────────
   The largest single win on how a spoken answer sounds is not the voice, it is
   the sentences. A premium voice reading a bulleted report still sounds like a
   machine, because cadence lives in clause length and structure rather than in
   timbre. This block is therefore load-bearing for the whole voice mode — and
   it is only worth anything if all four links exist, which is what these check.
   A prompt block nobody sets, or a flag nobody reads, is the dead-code shape
   this repository keeps finding in itself. */

const spokenShell = read("app/components/app-shell.tsx");
const spokenRoute = read("app/api/chat/route.ts");

/* 1. The client can ask for it, and only the spoken path does. */
check("the request body carries a voice flag", /voice: spoken,/.test(spokenShell.code), true);
check("the spoken submit path sets it", /requestBody\(text, true\)/.test(spokenShell.code), true);
/* Dictating into the composer produces an answer the person reads; shortening
   that would be a loss. What earns the shorter form is the reply being heard. */
check("the typed path does not", /body: requestBody\(text\) \}/.test(spokenShell.code), true);

/* 2. The route reads it, strictly. A client that has not reloaded sends
   nothing, which must read as a written answer rather than as undefined. */
check("the route reads the flag as a strict boolean", /body\.voice === true/.test(spokenRoute.code), true);

/* 3. It reaches the prompt builder. */
check("the flag is passed to the prompt builder", /spoken: spokenReply/.test(spokenRoute.code), true);
check("the builder accepts it", /spoken = false/.test(spokenRoute.code), true);

/* 4. And it produces instructions that are actually about being heard. */
check("the block forbids markup a voice cannot pronounce",
  /no headings, no bullets, no bold, no code fences/i.test(spokenRoute.source), true);
check("it asks for one idea at a time", /One idea at a time/.test(spokenRoute.source), true);
check("it pushes the answer before the preamble", /Open with the answer, not a preamble/.test(spokenRoute.source), true);
/* The pillar most likely to be lost: the work stays the same, only the writing
   changes. A voice mode that quietly thinks less is a worse product than one
   that talks like a document. */
check("depth is not traded away for brevity, only the full detail is deferred",
  /the rest is on screen/.test(spokenRoute.source), true);
check("and a long task is acknowledged rather than narrated step by step",
  /say so in a sentence and get on with it/.test(spokenRoute.source), true);

/* ── The diagnostic and the code must read the same list ────────────────────
   `checkTranscription` fetched the provider's catalogue, saw a 200, and
   reported "the token is valid and the router answered" — a fact about the
   credential that says nothing about whether any model that transcribes speech
   can be reached. A valid token aimed at models the account cannot serve fails
   every dictation while the diagnostic reports success, and it reaches the
   person as a microphone that does not work. Same credential-versus-model gap
   `checkModelRoutes` closes for chat, left open on the surface where it hurts
   most. */

const transcribeRoute = read("app/api/voice/transcribe/route.ts");
const diagnostics = read("lib/ai/diagnostic-tools.ts");
const sharedModels = read("lib/ai/voice/transcription-models.ts");

check("the candidate list lives in one module", /export function transcriptionCandidates/.test(sharedModels.code), true);
check("the route that calls them reads it", /transcriptionCandidates\(\)/.test(transcribeRoute.code), true);
check("and the diagnostic that checks them reads the same one",
  /transcriptionCandidates\(\)/.test(diagnostics.code), true);
/* Two copies would drift, and the drifted one would be the diagnostic —
   reporting on models nobody calls while silent about the ones failing. */
check("no second hardcoded whisper list survives in the route",
  /"openai\/whisper-large-v3"/.test(transcribeRoute.code), false);

/* Each attempt carries its own endpoint and credential. Capturing a token from
   the enclosing scope is precisely what pinned this route to one provider —
   the raw-bytes fallback still used a Hugging Face token by assumption. */
check("every attempt uses the candidate's own credential",
  /Bearer \$\{candidate\.token\}/.test(transcribeRoute.code), true);
check("and the candidate's own endpoint", /fetch\(candidate\.endpoint/.test(transcribeRoute.code), true);
check("no lingering hardcoded transcription host in the multipart call",
  /fetch\("https:\/\/router\.huggingface\.co\/v1\/audio\/transcriptions"/.test(transcribeRoute.code), false);

/* The catalogue read is the chat-completions listing, while transcription
   posts to the audio endpoint — so "not listed" is evidence, not proof, and
   saying otherwise would send someone chasing a model that already works. */
check("the diagnostic states the catalogue is a hint rather than proof",
  /strong hint rather than proof/.test(diagnostics.source), true);
check("an unreadable catalogue is reported as unconfirmed, not as failure",
  /unconfirmed/.test(diagnostics.source), true);
check("and the fix offered sidesteps the uncertainty entirely",
  /Set GROQ_API_KEY to route speech-to-text through Groq/.test(diagnostics.source), true);

/* The ladder's behaviour — ordering, per-host ids, credential gating — is
   exercised in `transcription-ladder.test.ts`, which runs under tsx and can
   import the module. This file reads source and runs under plain node. */

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
