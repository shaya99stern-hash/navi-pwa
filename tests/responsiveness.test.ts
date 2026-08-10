import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTACHMENT_BUDGET, attachmentBudgetFor } from "@/lib/ui/attachments";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

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

const shell = readFileSync(join(process.cwd(), "app/components/app-shell.tsx"), "utf8");
check("the composer measures the conversation", shell.includes("const conversationBytes = JSON.stringify(messages).length"), true);
check("and passes it to the sizer", /prepareAttachments\(pendingFiles, preserveDetail, conversationBytes\)/.test(shell), true);

/* ── Old attachments are not replayed forever ────────────────────────────────
   Uploaded files travel as base64 data URLs. Replaying every one of them on
   every turn is megabytes of upload from a phone before a single token can be
   generated — a large part of why the app felt slow. */

const route = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
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
check("mode guidance follows the user's own choice", route.includes('productMode === "code" ? codeModeInstruction() : chatModeInstruction()'), true);
check("the old dispatch-keyed form is gone", /\bmode === "code" \? codeModeInstruction\(\) : ""/.test(route), false);

/* ── Dictation survives a pause ──────────────────────────────────────────────
   This was seven assertions about keeping `webkitSpeechRecognition` alive
   across a breath: continuous off so iOS does not hold the microphone through
   an app switch, restart-on-end so a thinking pause does not end the turn, a
   fatal-error set so a refused permission does not loop, a flag so restarts do
   not re-announce the start. Every one of them was scaffolding around an API
   that does not work in an installed PWA.

   Recording has none of those problems by construction. The microphone is held
   for exactly as long as the button says it is, a pause is just quiet audio,
   and there is nothing to restart — so the property to protect is no longer
   "it recovers well" but "it is not used at all". */

const speech = readFileSync(join(process.cwd(), "lib/ui/speech.ts"), "utf8");
const recorder = readFileSync(join(process.cwd(), "lib/ui/recorder.ts"), "utf8");

check("nothing recognises speech any more", /SpeechRecognition/.test(speech), false);
check("dictation records instead", recorder.includes("new MediaRecorder"), true);
/* A pause is silence in the middle of one recording, not the end of it. */
check("the recording runs until it is stopped", /recorder\.start\(\)/.test(recorder), true);
/* The microphone must be released on every exit, or the browser's recording
   indicator stays lit after the sheet is gone — the same failure `continuous`
   was rejected for. */
check("stopping releases the microphone", /for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/.test(recorder), true);
check("abandoning it releases the microphone too", /cancel\(\) \{[\s\S]{0,120}teardown\(\)/.test(recorder), true);
/* A stray tap is not speech, and sending it produces a 400 rather than a
   transcript. */
check("a too-short recording is not sent", /blob\.size < 1_200/.test(recorder), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
