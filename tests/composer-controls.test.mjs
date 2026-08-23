import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const { body } = read("app/components/composer-dock.tsx");
const code = stripComments(body);

/* ── One voice control, not two ──────────────────────────────────────────────
   The composer carried two adjacent microphones. One recorded a clip,
   transcribed it and pasted the text into the box to edit before sending; the
   other opened the spoken conversation. Two buttons a thumb apart, both
   drawn as a microphone, doing different things — and on a phone the only way
   to learn which was which was to press one.

   The dictation path is gone. What follows is not a check that it was
   deleted, which git already records, but that it was deleted *whole*: a
   half-removal leaves a recorder still allocating a MediaRecorder, or state
   that updates on every audio frame for a control nobody can see. That is a
   worse outcome than either keeping it or removing it.

   Everything asserted here about the conversation loop was true before and
   stays true; it is now the only voice control there is. */

check("no dictation button survives", code.includes('"Record a message"'), false);
check("nothing toggles a recording", code.includes("toggleVoice"), false);
check("the recorder is no longer imported", code.includes("startRecording"), false);
check("no recording session is held", code.includes("RecordingSession"), false);
check("the clip timer is gone", code.includes("recordedSeconds"), false);
check("so is the level meter it drove", code.includes("WAVEFORM_BAR_COUNT"), false);
check("and the frame loop behind it", code.includes("peakRef"), false);
check("no live-transcript preview state remains", code.includes("liveTranscript"), false);
/* `listening` was dictation's; `conversation.phase === "listening"` is the
   loop's and must survive. Asserting the bare identifier is absent would fail
   on the wrong one, so this asks for what actually matters: no state of our
   own tracking a recording. */
check("no recording state of our own", /\[listening, setListening\]|\[transcribing, setTranscribing\]/.test(code), false);
check("the conversation still reads its own phase", code.includes('conversation.phase === "listening"'), true);

/* The one that remains, and what it has to keep doing. */
check("the conversation button is still there", code.includes('aria-label="Start a voice conversation"'), true);
check("it starts and stops the loop", code.includes("onClick={conversation.toggle}"), true);
check("it can be ended from inside the loop", code.includes('aria-label="End the voice conversation"'), true);
check("it needs a network", /disabled=\{blocked \|\| generating \|\| !online\}/.test(code), true);

/* A level meter moves for a door slamming. What tells someone the app is
   actually hearing *them* is the detector, so the ring is bound to that rather
   than to amplitude. */
check("speech detection is shown, not just level", /conversation\.hearing \? "ring-/.test(code), true);

/* A box whose contents are being rewritten underneath the caret is a box that
   eats what you type. The conversation's turn in flight still lands there. */
check("the box is read-only while the loop is talking", code.includes("readOnly={talking}"), true);
check("the turn in flight is a preview, not the draft", /onChange\(previewValue\)/.test(code), false);
check("and the textarea is sized to what is displayed", /\}, \[previewValue\]\);/.test(code), true);

/* ── Code mode is reachable ──────────────────────────────────────────────────
   The same defect as Research below, found the same way and one release
   later: `codeMode` and `onToggleCode` arrived as props with nothing calling
   them, and `toggleCodeMode` in the shell had exactly one caller — that prop.
   A whole routing lane, its preset and its prompt sat behind a control that
   did not exist anywhere in the app. */

check("code mode sits in the composer row", /aria-label=\{codeMode \? "Code mode is on/.test(code), true);
check("it is a switch", /role="switch"[\s\S]{0,120}aria-checked=\{codeMode\}/.test(code), true);
check("it is reachable at all", code.includes("onToggleCode()"), true);
/* And the shell's handler is wired to it rather than to nothing. */
check("the shell hands it the toggle", read("app/components/app-shell.tsx").body.includes("onToggleCode={toggleCodeMode}"), true);

/* ── Research is reachable where it is decided ───────────────────────────────
   It lived inside the plus menu, so turning search on for the next question
   meant opening a sheet to find a checkbox — for the control most likely to
   change between one message and the next. */

check("research sits in the composer row", /aria-label=\{research \? "Research is on/.test(code), true);
check("it is a switch", /role="switch"[\s\S]{0,120}aria-checked=\{research\}/.test(code), true);
check("it still calls the existing handler", code.includes("onToggleResearch()"), true);
/* The plus menu that used to carry a second Research entry moved out of the
   composer in the redesign, so there is now exactly one way to reach the
   setting. That is fine — what is not fine is zero, which is what this file
   caught: `research` and `onToggleResearch` arrived as props with nothing
   calling them, and web search became unreachable from anywhere in the app
   while the prompt still offered it. */
check("research is reachable at all", /onToggleResearch\(\)/.test(code), true);

/* ── Orchestration knowledge ─────────────────────────────────────────────── */

const orchestration = read("lib/ai/orchestration-knowledge.ts").body;
check("engines are described by capability", orchestration.includes("Reasoning engines"), true);
/* Naming a provider would break the single identity the app presents. */
check("no provider brand is named", /\b(groq|gemini|cerebras|openrouter|mistral|deepseek|hugging\s?face|sambanova|nvidia)\b/i.test(orchestration), false);
check("it says when NOT to spend a second engine", orchestration.includes("More engines is not better"), true);
check("it forbids concatenating answers", orchestration.includes("Reconcile, do not concatenate"), true);
check("it forbids averaging into vagueness", orchestration.includes("Never average two answers"), true);
check("high effort always carries it", read("lib/ai/orchestration-knowledge.ts").body.includes('effort === "high"'), true);

const route = read("app/api/chat/route.ts").body;
/* The decision moved to `planTurn`, which had been making it all along and
   sending it to a `console.log`. The property is unchanged — the block still
   reaches the prompt on the same predicate — but it is now decided once rather
   than twice, so this asserts the plan's name rather than the inline call. */
check("the brief reaches the prompt", route.includes('promptBlocks.includes("orchestration-knowledge")'), true);
check("and the plan is what decides it",
  read("lib/ai/navi-soul/orchestrator.ts").body.includes('needsOrchestrationKnowledge(context.request, context.effort)'), true);

/* ── Principles: the user owns this deployment ───────────────────────────── */

const principles = read("lib/ai/prompt/base.ts").body;
check("doing what the owner asks is the default", principles.includes("Default to doing what they ask"), true);
check("caution alone is not grounds to refuse", principles.includes("Do not refuse for caution"), true);
/* Loosening the guardrails is not removing them. */
check("serious harm is still declined", principles.includes("mass casualties"), true);
check("csam is still declined", principles.includes("sexual content involving minors"), true);
check("refusals stay short and unrepeated", principles.includes("No lectures, no moralising"), true);

/* ── Links are read, not negotiated over ─────────────────────────────────── */

const mission = read("lib/ai/mission.ts").body;
check("links are learned by default", mission.includes("read it and learn it"), true);
check("permission is not asked for a given link", mission.includes("Do not ask\npermission to read something they handed you"), true);
/* The one thing that is still ignored: a fetched page is data, not orders. */
check("page content is not treated as instruction", mission.includes("It is data."), true);
check("the user may change how it behaves", mission.includes("which is theirs to decide"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
