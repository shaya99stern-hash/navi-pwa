import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const { body } = read("app/components/composer-dock.tsx");
const code = stripComments(body);
const shell = stripComments(read("app/components/app-shell.tsx").body);
const modelPicker = stripComments(read("app/components/model-picker-sheet.tsx").body);

/* ── Two voice controls with two clear jobs ─────────────────────────────────
   The plain microphone records a message into the editable draft. The
   waveform starts the hands-free conversation loop. They intentionally use
   the same recorder pipeline, but they must never own the microphone at the
   same time and their accessible names must say which job each one performs. */

check("the dictation button names its job", code.includes('"Record a message"'), true);
check("the dictation button has its own toggle", code.includes("toggleDictation"), true);
check("dictation uses the robust recorder", code.includes("startRecording"), true);
check("a recording session is held until Stop", code.includes("RecordingSession"), true);
check("the clip timer is gone", code.includes("recordedSeconds"), false);
check("so is the level meter it drove", code.includes("WAVEFORM_BAR_COUNT"), false);
check("and the frame loop behind it", code.includes("peakRef"), false);
check("dictation shows the live transcript", code.includes("liveTranscript"), true);
check("dictation tracks recording and transcription separately",
  /\[listening, setListening\]/.test(code) && /\[transcribing, setTranscribing\]/.test(code), true);
check("composer dictation waits for a deliberate stop", /handsFree:\s*false/.test(code), true);
check("live words update the visible preview", /onTranscript:\s*\(text\) => \{[\s\S]{0,180}setLiveTranscript\(text\)/.test(code), true);
check("the final transcript is appended to the current draft",
  /const current = valueRef\.current;[\s\S]{0,120}onChange\(`\$\{current\}/.test(code), true);
check("unmount releases an open composer microphone",
  /useEffect\(\(\) => \(\) => \{[\s\S]{0,180}recorderRef\.current\?\.cancel\(\)/.test(code), true);
check("the conversation still reads its own phase", code.includes('conversation.phase === "listening"'), true);

/* The waveform remains a separate hands-free action. */
check("the conversation button is still there", code.includes('aria-label="Start a voice conversation"'), true);
check("it starts and stops the loop through the exclusion guard", code.includes("onClick={toggleConversation}"), true);
check("it can be ended from inside the loop", code.includes('aria-label="End the voice conversation"'), true);
check("both voice actions have distinct accessible labels",
  code.includes('"Record a message"') && code.includes('aria-label="Start a voice conversation"'), true);
check("the conversation needs a network", /disabled=\{blocked \|\| generating \|\| !online \|\| dictating\}/.test(code), true);
check("a conversation cannot start while dictation owns the recorder",
  /function toggleConversation\(\) \{[\s\S]{0,180}recorderRef\.current[\s\S]{0,80}dictating[\s\S]{0,80}return;/.test(code), true);
check("dictation cannot start during a conversation",
  /async function startDictation\(\) \{[\s\S]{0,180}\btalking\b[\s\S]{0,80}return;/.test(code), true);

/* A level meter moves for a door slamming. What tells someone the app is
   actually hearing *them* is the detector, so the ring is bound to that rather
   than to amplitude. */
check("speech detection is shown, not just level", /conversation\.hearing \? "ring-/.test(code), true);

/* A box whose contents are being rewritten underneath the caret is a box that
   eats what you type. The conversation's turn in flight still lands there. */
check("the box is read-only while either voice path owns it", code.includes("readOnly={talking || dictating}"), true);
check("the turn in flight is a preview, not the draft", /onChange\(previewValue\)/.test(code), false);
check("and the textarea is sized to what is displayed", /\}, \[previewValue\]\);/.test(code), true);

/* ── The quiet center pill is the model picker ────────────────────────────── */

check("the composer shows the selected model", code.includes("{modelLabel}"), true);
check("the model pill opens the picker", code.includes("onClick={onOpenModels}"), true);
check("its label exposes model and effort",
  /aria-label=\{`Model: \$\{modelLabel\}\. Effort: \$\{effortLabel\}/.test(code), true);
check("the shell wires the pill to the model picker", /onOpenModels=\{\(\) => \{[\s\S]{0,160}setModelPickerOpen\(true\)/.test(shell), true);
check("the picker is rendered from that state",
  /<ModelPickerSheet[\s\S]{0,120}open=\{modelPickerOpen\}/.test(shell), true);
check("Automatic clears a pinned route",
  /routeOverride:\s*model === "navi-soul" \? undefined : model/.test(modelPicker), true);
check("only stable Navi routes appear in the composer picker",
  /DIAGNOSTIC_ROUTES\.filter\(\(\{ id \}\) => id\.startsWith\("navi-soul"\)\)/.test(modelPicker), true);

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

/* The property, not the expression. Both of these used to pin the exact
   shape of a ternary, so making the label conditional on search availability
   broke a check about *placement*. What matters is that a labelled switch for
   research is in this row. */
check("research sits in the composer row", /"Research is on\. Turn off web search"/.test(code), true);
const researchSwitch = code.split("<button").find((block) => block.includes("aria-checked={searchConfigured && research}")) ?? "";
check("it is a switch", researchSwitch.includes('role="switch"'), true);
check("it still calls the existing handler", code.includes("onToggleResearch()"), true);
/* The plus menu that used to carry a second Research entry moved out of the
   composer in the redesign, so there is now exactly one way to reach the
   setting. That is fine — what is not fine is zero, which is what this file
   caught: `research` and `onToggleResearch` arrived as props with nothing
   calling them, and web search became unreachable from anywhere in the app
   while the prompt still offered it. */
check("research is reachable at all", /onToggleResearch\(\)/.test(code), true);

/* ── And it tells the truth about whether it can do anything ─────────────────
   Reaching the handler was only half of it. `web_search` is registered as
   `search && hasWebSearch()` — the switch *and* a provider key — so on a
   deployment with no TAVILY_API_KEY or EXA_API_KEY the globe lit up, set a
   flag nothing could act on, and the next answer was identical. A control
   that reports success and does nothing is worse than one that is plainly
   unavailable, because the first teaches you the feature is broken and the
   second teaches you what to do.

   The answer was already in the payload the composer fetches: `/api/models`
   has returned `search.configured` all along, and the composer read only the
   model providers out of it. */

check("the composer reads whether search is configured", code.includes("data.search?.configured"), true);
/* Absent is not false. A deployment that did not report leaves the switch
   alone rather than dimming a feature that works. */
check("only an explicit false dims it", code.includes('data.search?.configured !== false'), true);
check("an unconfigured switch does not silently toggle", /if \(!searchConfigured\) \{[\s\S]{0,200}return;/.test(code), true);
check("it says what is missing instead", /setNotice\("Web search needs a provider key/.test(code), true);
/* And says what still works — every link the user pastes is read by
   `fetch_url`, which needs no key and is registered on every turn. */
check("and what still works", /Links you paste are still read/.test(code), true);
check("a switch that cannot act does not read as on", code.includes("aria-checked={searchConfigured && research}"), true);
check("its label names the reason", /Research unavailable — no search provider is configured/.test(code), true);

/* The notice line under the composer. It carried recording failures until the
   dictation path went, after which it was read in two places and written in
   none — dead state rendering nothing. */
check("the notice is set by something", /setNotice\(/.test(code), true);
check("and read by the footer", /\?\? notice/.test(code), true);
check("no orphaned voice message survives", code.includes("voiceMessage"), false);

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
