/* Mirrors the route's own heuristics so the decision path is testable without
   a live provider. Kept in lockstep with app/api/chat/route.ts. */
type Effort = "normal" | "complex" | "extreme";
type EffortLevel = "low" | "medium" | "high";
type Dispatch = "code" | "research" | "reasoning" | "general";

const CODE_REQUEST = /\b(code|coding|function|class|method|variable|compile|compiler|syntax|refactor|debug|bug|stack trace|exception|typescript|javascript|python|rust|golang|java|swift|kotlin|sql|html|css|react|next\.?js|vue|svelte|node|npm|yarn|docker|kubernetes|git|regex|api endpoint|unit test|null pointer|segfault|npm install|traceback)\b/i;
const RESEARCH_REQUEST = /\b(search|research|investigate|look ?up|look into|find out|deep ?dive|latest|current|today|this (?:week|month|year)|news|who is|what happened|according to|source|sources|cite|citation|price of|stock|weather|release date|is it true|fact ?check)\b/i;

function complexity(text: string): Effort {
  const extreme = text.length > 1_800 || /\b(exhaustive|deep audit|production-ready|entire codebase|long-horizon|multi-agent|research report|principal architect)\b/i.test(text);
  if (extreme) return "extreme";
  const complex = text.length > 650 || /\b(architecture|audit|analy[sz]e|debug|proof|strategy|compare|research|legal|financial|medical|typescript|javascript|react|next\.?js|python|sql|multi-step|comprehensive)\b/i.test(text);
  return complex ? "complex" : "normal";
}
function dispatchFor(text: string, band: Effort, effort: EffortLevel): Dispatch {
  if (CODE_REQUEST.test(text)) return "code";
  if (RESEARCH_REQUEST.test(text)) return "research";
  if (band !== "normal" || effort === "high") return "reasoning";
  return "general";
}
function resolveHeadlinePreset(o: { preset: string; complexityBand: Effort; effort: EffortLevel; providerCount: number; hasFiles: boolean; needsLiveSources: boolean }): string {
  if (o.providerCount < 2 || o.hasFiles) return o.preset;
  if (o.needsLiveSources) return o.preset;
  if (o.effort !== "high" || o.complexityBand === "normal") return o.preset;
  if (o.preset === "navi-soul" || o.preset === "auto") return "navi-sol";
  if (o.preset === "navi-code") return "navi-fable";
  return o.preset;
}

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${String(actual)}, want ${String(expected)}`}`);
};

const route = (text: string, effortLevel: EffortLevel, webOn: boolean, searchKey: boolean) => {
  const band = complexity(text);
  const dispatch = dispatchFor(text, band, effortLevel);
  const preset = resolveHeadlinePreset({
    preset: "navi-soul", complexityBand: band, effort: effortLevel,
    providerCount: 6, hasFiles: false,
    needsLiveSources: dispatch === "research" && webOn && searchKey
  });
  return { dispatch, preset };
};

// The exact failing request from the screenshot: Navi Soul, High, Research on.
const cows = route("Can you do a deep research on cows", "high", true, true);
check("'deep research on cows' dispatches as research", cows.dispatch, "research");
check("'deep research on cows' stays on the direct route (can browse)", cows.preset, "navi-soul");

// Without a search key there is nothing to browse, so deliberation is the better use of High.
check("no search key at High still escalates to the swarm",
  route("Can you do a deep research on cows", "high", true, false).preset, "navi-sol");
// Research mode off means the user did not ask for sources.
check("research mode off at High still escalates",
  route("Can you do a deep research on cows", "high", false, true).preset, "navi-sol");

// Non-research hard work should still get the swarm at High.
check("architecture question at High escalates",
  route("Compare the architecture tradeoffs of event sourcing", "high", true, true).preset, "navi-sol");
// Medium effort never escalates regardless.
check("medium effort never escalates",
  route("Can you do a deep research on cows", "medium", true, true).preset, "navi-soul");

// Research phrasings that previously fell through to generic reasoning.
for (const phrase of ["do a deep research on cows", "investigate the causes", "find out who won", "look into this", "deep dive on rates"]) {
  check(`'${phrase}' → research`, dispatchFor(phrase, complexity(phrase), "medium"), "research");
}
// Code still wins over research when both appear.
check("code beats research", dispatchFor("research why my typescript build fails", "complex", "high"), "code");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

export {};
