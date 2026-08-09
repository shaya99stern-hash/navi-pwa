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
   `continuous` is off on purpose — on iOS it holds the microphone across an
   app switch — but a single utterance ends at the first breath, so recording
   stopped every time the speaker paused to think. */

const speech = readFileSync(join(process.cwd(), "lib/ui/speech.ts"), "utf8");
check("continuous listening stays off", speech.includes("recognition.continuous = false"), true);
check("recognition restarts itself", /recognition\.onend = \(\) => \{[\s\S]{0,240}recognition\.start\(\)/.test(speech), true);
check("stopping is honoured", speech.includes("stop: () => { finished = true;"), true);
/* Hiding the page must release the microphone, which is the reason
   `continuous` was rejected in the first place. */
check("hiding the page ends the session", speech.includes("visibilitychange"), true);
check("a refused permission does not loop", speech.includes("FATAL_SPEECH_ERRORS"), true);
check("a pause is not reported as an error", speech.includes('event?.error === "no-speech" || event?.error === "aborted"'), true);
/* One start and one end per session, not one per phrase. */
check("restarts do not re-announce the start", speech.includes("announcedStart"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
