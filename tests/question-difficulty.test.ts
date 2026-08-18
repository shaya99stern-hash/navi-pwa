import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complexity } from "@/lib/ai/question-difficulty";
import { selectLane, routeForLane, ROUTES, type ProviderAvailability } from "@/lib/ai/providers";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Why the app read as "way too low intelligence" ──────────────────────────
   Difficulty was decided almost entirely by character count: over 650 was hard,
   under it was not. Length is a property of how somebody typed, not of what
   they asked.

   The bias fell hardest on speech, where it was close to total. Spoken turns
   are short by nature, so a voice conversation could not reach the reasoning
   lane at all — every answer the owner has heard aloud came from the fast one.
   That is a complete explanation for an app that reads as weak when talked to
   and better when typed at, and no amount of swapping models would have fixed
   it, because the strong models were never being asked. */

const short = "Which of these two contracts should I sign?";
check("a short question that needs judgement is not called simple", complexity(short), "complex");
check("and it is genuinely short", short.length < 650, true);

for (const question of [
  "why is this happening",
  "how should I structure it",
  "what's the best way to do this",
  "should we wait or move now",
  "compare the two options",
  "is it worth it",
  "explain what went wrong",
  "help me think about this",
  "what if we did it the other way"
]) {
  check(`"${question}" reaches the reasoning lane`, complexity(question), "complex");
}

/* The other half of the bargain: brevity is still a signal when nothing in the
   question asks for judgement. Sending every greeting to a reasoning model buys
   a slower answer to "hello" and nothing else. */
for (const question of ["hey, how you doing", "what time is it in Tokyo", "thanks", "what is 12% of 4300", "spell accommodate"]) {
  check(`"${question}" stays on the fast path`, complexity(question), "normal");
}

/* Length still carries a long pasted brief, and the extreme band is untouched. */
check("a long brief is still complex", complexity("a".repeat(700)), "complex");
check("and a very long one is still extreme", complexity("a".repeat(2_000)), "extreme");
check("as are the words that always meant it",
  complexity("do a deep audit of the entire codebase"), "extreme");

/* ── What that means for the model that answers ──────────────────────────────
   The classifier only matters through the lane it selects. */

const lane = (complex: boolean) => selectLane({ mode: "chat", effort: "medium", complex, hasFiles: false, longContext: false });
check("a judgement question at medium effort takes the reasoning lane", lane(true), 3);
check("and an ordinary one still takes the balanced lane", lane(false), 2);

/* ── Lane 2 had nowhere to fall ──────────────────────────────────────────────
   With neither balanced provider configured it returned null, so a deployment
   holding a reasoning provider dropped out of lane selection entirely and was
   served by the generic ladder — a weaker answer chosen because the
   *balanced* shelf was empty, not because nothing better existed. */

const avail = (on: Partial<Record<string, boolean>>) => ({
  gemini: false, groq: false, huggingface: false, cerebras: false, openrouter: false,
  deepseek: false, mistral: false, together: false, nvidia: false, sambanova: false, ...on
}) as ProviderAvailability;

const forLane2 = (availability: ProviderAvailability) =>
  routeForLane({ lane: 2, availability, tools: { web: false, code: false, artifacts: false }, hasFiles: false, discovered: null, meteredAllowed: false, taskKind: null } as never);

check("lane 2 still prefers the balanced route when there is one",
  forLane2(avail({ gemini: true, cerebras: true }))?.model, ROUTES.geminiSynthesis.model);
check("but reaches for a stronger one rather than nothing",
  forLane2(avail({ cerebras: true }))?.model, ROUTES.cerebrasLarge.model);
check("and for another when that is absent too",
  forLane2(avail({ groq: true }))?.model, ROUTES.groqReasoning.model);
check("with nothing configured it still declines", forLane2(avail({})), null);

/* ── The classifier is reachable ─────────────────────────────────────────────
   It lived inside a module that imports `server-only`, so nothing could test
   the single largest influence on how the app reads. */

const route = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
check("the route imports it rather than holding it",
  /import \{ complexity, type Effort \} from "@\/lib\/ai\/question-difficulty";/.test(route), true);
check("and no longer defines it inline", /function complexity\(text: string\): Effort \{/.test(route), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
