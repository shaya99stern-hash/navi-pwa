import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const { body } = read("app/components/composer-dock.tsx");
const code = stripComments(body);

/* ── The mic is a toggle, not a hold ─────────────────────────────────────────
   The defect: pointerdown started recording and pointerup stopped it, so a
   normal tap — a pointerdown and a pointerup milliseconds apart — started and
   instantly stopped it. The button did nothing at all unless held perfectly
   still for a whole sentence, and a scroll or a permission prompt cancelled
   the gesture. "The microphone doesn't work" was literally true. */

check("the mic toggles on click", /onClick=\{toggleVoice\}/.test(code), true);
check("pointer-down no longer starts recording", /onPointerDown=\{\(\) => \{ holdingMic/.test(code), false);
check("the hold-tracking ref is gone", code.includes("holdingMic"), false);
check("the idle label invites recording", code.includes('"Record a message"'), true);

/* Recording must be legible while it happens: a lit icon says something is
   on, a running clock says you are being heard. */
check("recording time is tracked", code.includes("recordedSeconds"), true);
check("the timer only runs while listening", /if \(!listening\) \{ setRecordedSeconds\(0\); return; \}/.test(code), true);
/* Counting up rather than down. The countdown existed because a whole
   recording had to fit in one request; nothing is held whole now, and a
   deadline on screen is a thought cut short. */
check("the clock counts up rather than towards a limit", /remainingSeconds/.test(code), false);
/* The recording bar carries the clock and the level, so the footer speaks
   only for transcription — the state with no other indicator. */
check("transcription is reported", code.includes('transcribing ? "Transcribing…" : null'), true);
check("transcription reads as active, not as a warning", code.includes('talking || transcribing\n      ? "text-accent"'), true);

/* ── The waveform is a record, not a decoration ──────────────────────────────
   It was fifteen fixed weights driven through a sine of the elapsed second,
   so it moved identically whether the microphone was picking up a voice or
   picking up nothing — which is exactly the question the person watching it
   is asking. */
check("the fake waveform is gone", code.includes("Math.sin"), false);
check("a live waveform is drawn", code.includes("WAVEFORM_BAR_COUNT"), true);
check("from a scrolling history of real levels", /waveformRef\.current, peakRef\.current\]\.slice\(-WAVEFORM_BAR_COUNT\)/.test(code), true);
/* Each bar is the peak of the window it covers, so a short loud syllable
   cannot fall between two animation frames and vanish. */
check("each bar holds the peak of its window", /peakRef\.current = Math\.max\(peakRef\.current, level\)/.test(code), true);
/* Fifty levels a second through React state to move a row of bars is
   measurable on a phone, and the bars only redraw sixty times a second. */
check("levels are drained on an animation frame, not per sample", /requestAnimationFrame\(tick\)/.test(code), true);
/* Whether the detector believes it is hearing a voice is a stronger statement
   than bar height, which moves on room noise too. */
check("speech detection is shown, not just level", /speaking \? "ring-accent"/.test(code), true);
check("recording can be discarded", code.includes("Discard recording"), true);

/* ── The words arrive while they are still being spoken ──────────────────────
   The whole point of the rewrite. Segments upload as they close, so the
   transcript grows during the recording rather than after it. */
check("the transcript streams in", code.includes("onTranscript: setLiveTranscript"), true);
check("and is shown in the composer where it will end up", code.includes("previewValue"), true);
/* A box whose contents are being rewritten underneath the caret is a box that
   eats what you type. */
/* Both kinds of microphone put words in this box that the person did not
   type: dictation's preview, and the conversation's turn in flight. */
check("the box is read-only while it is a preview", code.includes("readOnly={dictating || talking}"), true);
/* It is a preview until the recording is accepted, so discarding one is a
   discard rather than an undo. */
check("the preview is not written into the draft", /onChange\(previewValue\)/.test(code), false);
check("discarding clears it", /function cancelVoice\(\)[\s\S]{0,220}setLiveTranscript\(""\)/.test(code), true);
check("and the textarea is sized to what is displayed", /\}, \[previewValue\]\);/.test(code), true);

/* ── Research is reachable where it is decided ───────────────────────────────
   It lived inside the plus menu, so turning search on for the next question
   meant opening a sheet to find a checkbox — for the control most likely to
   change between one message and the next. */

check("research sits in the composer row", /aria-label=\{research \? "Research is on/.test(code), true);
check("it is a switch", /role="switch"[\s\S]{0,120}aria-checked=\{research\}/.test(code), true);
check("it still calls the existing handler", code.includes("onToggleResearch()"), true);
/* The plus menu keeps its entry: two ways to reach one setting is fine, and
   removing the old one would relocate a control people have learned. */
check("the menu entry survives", code.includes('role="menuitemcheckbox"'), true);

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
