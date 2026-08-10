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
/* The recording bar carries the clock and the level, so the footer speaks
   only for transcription — the state with no other indicator. */
check("transcription is reported", code.includes('transcribing ? "Transcribing…" : null'), true);
check("transcription reads as active, not as a warning", code.includes('transcribing\n    ? "text-accent"'), true);
check("a live waveform is drawn", code.includes("WAVEFORM_BARS"), true);
check("the waveform follows the real input level", code.includes("inputLevel"), true);
check("recording can be discarded", code.includes("Discard recording"), true);

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
check("the brief reaches the prompt", route.includes("needsOrchestrationKnowledge(request, effort)"), true);

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
