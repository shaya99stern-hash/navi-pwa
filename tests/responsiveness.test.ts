import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTACHMENT_BUDGET, attachmentBudgetFor } from "@/lib/ui/attachments";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n?/g, "\n");

/* ── The attachment budget follows the real conversation ─────────────────────
   The defect: the budget assumed a fixed 400 KB of conversation, so in a chat
   that already contained photos an image was resized to "fit" and the request
   still overran the Edge body cap. The user saw "Image resized to fit the
   request limit" immediately followed by "That didn't go through". */

check("a small conversation gets the full budget", attachmentBudgetFor(0), ATTACHMENT_BUDGET);
check("a tiny conversation does not exceed it", attachmentBudgetFor(1_000) <= ATTACHMENT_BUDGET, true);

const heavy = attachmentBudgetFor(2_500_000);
check("a heavy conversation shrinks the budget", heavy < ATTACHMENT_BUDGET, true);
check("the budget never goes negative", heavy > 0, true);
/* Compressing a photo into mud to make room is worse than saying the
   conversation is full, so there is a floor rather than an ever-shrinking
   budget. */
check("an enormous conversation still returns the floor", attachmentBudgetFor(50_000_000), 250_000);
check("the budget falls as the conversation grows", attachmentBudgetFor(3_000_000) < attachmentBudgetFor(1_000_000), true);

const shell = readSource("app/components/app-shell.tsx");
check("the composer measures the conversation", shell.includes("const conversationBytes = JSON.stringify(messages).length"), true);
check("and passes it to the sizer", /prepareAttachments\(pendingFiles, preserveDetail, conversationBytes\)/.test(shell), true);

/* ── Old attachments are not replayed forever ────────────────────────────────
   Uploaded files travel as base64 data URLs. Replaying every one of them on
   every turn is megabytes of upload from a phone before a single token can be
   generated — a large part of why the app felt slow. */

const route = readSource("app/api/chat/route.ts");
check("stale attachments are redacted", route.includes("function redactStaleAttachments"), true);
check("the redaction runs on the replayed history", route.includes("redactStaleAttachments(messages)"), true);
check("a replay window exists", route.includes("ATTACHMENT_REPLAY_WINDOW"), true);
/* A window rather than only-the-latest: "what about the top-left corner?" is
   a normal follow-up and must still see the picture. */
check("the window keeps more than the last message", /ATTACHMENT_REPLAY_WINDOW = ([4-9]|\d\d)/.test(route), true);
/* The model must know something was there, or it will conclude the file never
   existed and contradict the user. */
check("a dropped attachment leaves a note", route.includes("was attached earlier in this conversation"), true);

/* ── The mode switch changes behaviour on every turn ─────────────────────────
   Code-mode guidance was keyed to the dispatcher's classification, so picking
   Code and asking something classified as ordinary produced a reply identical
   to Chat's. */

check("chat mode is stated, not merely implied", route.includes("function chatModeInstruction"), true);
check("mode guidance follows the user's own choice", route.includes('productMode === "code" ? codeModeInstruction(toolNames.includes("commit_own_source"), toolNames.includes("github_open_pr")) : chatModeInstruction()'), true);
/* The capability statement has to be derived from the tools actually present.
   It used to be flat prose ending "those tools are read-only... say it has to
   be applied by hand" — on every Code-mode turn, including the ones where
   `commit_own_source` was in the toolset. Asked to change the app, Navi Soul
   handed back a diff and declined, because that is what it had been told. */
check("code mode takes whether it can commit", /function codeModeInstruction\(canCommit: boolean, canWriteRepos: boolean\)/.test(route), true);
/* Two repositories, two mechanisms, and conflating them is what convinced the
   owner their other repositories were permanently off limits. This app's own
   source goes through the deployment's token and deploys; anything else goes
   through the user's own GitHub account, on a branch, via a pull request. */
check("it states the other-repository path separately", /canWriteRepos\s*\?\s*"You can also work in the user's other GitHub repositories/.test(route), true);
check("other repositories are never committed to directly", /never commit to a default branch in someone's repository/.test(route), true);
check("read-only is not described as permanent", /Do not describe this as a permanent limitation/.test(route), true);
check("it says it can commit when it can", /canCommit\s*\?\s*"You can commit to NaviOS's own repository/.test(route), true);
check("read-only applies only when neither path exists", /!canCommit && !canWriteRepos/.test(route), true);
check("the old dispatch-keyed form is gone", /\bmode === "code" \? codeModeInstruction\(\) : ""/.test(route), false);

/* ── Dictation survives a pause ──────────────────────────────────────────────
   This was seven assertions about keeping `webkitSpeechRecognition` alive
   across a breath: continuous off so iOS does not hold the microphone through
   an app switch, restart-on-end so a thinking pause does not end the turn, a
   fatal-error set so a refused permission does not loop, a flag so restarts do
   not re-announce the start. Every one of them was scaffolding around an API
   that does not work in an installed PWA.

   Capture has none of those problems by construction. The microphone is held
   for exactly as long as the button says it is, a pause is just quiet audio,
   and there is nothing to restart — so the property to protect is no longer
   "it recovers well" but "it is not used at all". */

const speech = readSource("lib/ui/speech.ts");
const recorder = readSource("lib/ui/recorder.ts");

check("nothing recognises speech any more", /SpeechRecognition/.test(speech), false);
/* And nothing encodes a container any more either. MediaRecorder hands back
   WebM, MP4 or Ogg depending on the browser, only the first chunk of which
   carries a header — so a slice of one cannot be decoded, and transcribing
   while someone is still speaking is impossible with it. Raw samples can be
   cut anywhere. */
check("dictation captures samples rather than a container", /new MediaRecorder/.test(recorder), false);
check("through the audio graph", /audioWorklet\.addModule/.test(recorder), true);
/* Deprecated, main-thread, and present on every device the worklet is not.
   A slightly worse recording beats a microphone that does nothing. */
check("with a fallback where the worklet will not load", /createScriptProcessor/.test(recorder), true);
/* A pause is silence in the middle of one recording, not the end of it: the
   detector closes a *segment* on a pause, and the recording carries on. */
check("a pause closes a segment, not the recording", /createSegmenter/.test(recorder), true);
check("and the recording only ends when it is stopped", /finished = true;\n {6}releaseMicrophone\(\)/.test(recorder), true);
/* The microphone must be released on every exit, or the browser's recording
   indicator stays lit after the sheet is gone — the same failure `continuous`
   was rejected for. */
check("stopping releases the microphone", /for \(const item of stream\.getTracks\(\)\) item\.stop\(\)/.test(recorder), true);
check("abandoning it releases the microphone too", /cancel\(\) \{[\s\S]{0,200}releaseMicrophone\(\)/.test(recorder), true);
/* Disconnecting an AudioWorkletNode does not retire it — only `process`
   returning false does — so a disconnected node stays scheduled on the audio
   thread for the life of the context. */
check("and retires the capture node rather than only unplugging it",
  /postMessage\("stop"\)/.test(recorder), true);
/* A stray tap is not speech. The guard used to be a byte count on the whole
   blob; it is now a duration of detected speech inside the segment, which is
   the thing actually being asked about. */
check("a stray tap is not sent", /minSpeechMs/.test(readSource("lib/ui/audio/vad.ts")), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
