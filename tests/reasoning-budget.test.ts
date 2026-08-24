/**
 * Thinking and answering come out of the same allowance.
 *
 * A reasoning model emits its deliberation as output tokens, counted against
 * the same `max_tokens` as the reply. On Groq's free tier the window is 8,000
 * for input *plus* reserved output, so a turn carrying the system prompt, the
 * artifact contract and a few tool schemas has roughly two to three thousand
 * left — and at default effort a model can spend most of that deciding what to
 * write.
 *
 * The failure that produced this file: asked for an interactive kitchen mood
 * board, the model reasoned at length and emitted
 *
 *     {"id":"kitchen-moodboard","title":"Kitchen Mood Board","kind":"html","height":500}
 *
 * and stopped. A complete, correct artifact header with no document under it.
 * Nothing was wrong with the request, the contract, or the model's
 * understanding of either — it had thought until there was no room left to
 * answer.
 */
import { acceptsReasoningEffort, reasoningEffortFor, reasoningProviderOptions, TIGHT_OUTPUT_TOKENS } from "@/lib/ai/reasoning-budget";
import { ROUTES } from "@/lib/ai/providers";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const roomy = 6_000;

/* ---- Only where the field is read ------------------------------------- */

/* An allowlist rather than "send it and hope". Most OpenAI-compatible
   endpoints ignore an unknown body field; not all do, and a 400 from a field
   we added would be a self-inflicted outage on the provider the app leads
   with. */
check("groq's gpt-oss reads it", acceptsReasoningEffort(ROUTES.groqReasoning), true);
check("so does the fast one", acceptsReasoningEffort(ROUTES.groqFast), true);
check("cerebras is not asked", acceptsReasoningEffort(ROUTES.cerebrasLarge), false);
check("nor gemini", acceptsReasoningEffort(ROUTES.geminiSynthesis), false);
check("nor hugging face", acceptsReasoningEffort(ROUTES.hfGptOss), false);
for (const route of [ROUTES.cerebrasLarge, ROUTES.geminiSynthesis, ROUTES.hfGptOss, ROUTES.mistralBalanced]) {
  check(`${route.provider} is left entirely alone`, reasoningProviderOptions({ route, outputTokens: 500, artifactRequested: true, effort: "medium" }), undefined);
}

/* ---- The case this exists for ----------------------------------------- */

check("an artifact turn stops deliberating", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: roomy, artifactRequested: true, effort: "medium" }), "low");
/* Even with room to spare. A whole styled, scripted document is the most
   output-heavy thing this app produces, and tokens spent thinking are tokens
   the document does not get. */
check("even when the budget looks comfortable", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: 7_500, artifactRequested: true, effort: "medium" }), "low");

/* ---- A tight budget, whatever the turn is ------------------------------ */

check("a tight budget stops deliberating", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: TIGHT_OUTPUT_TOKENS - 1, artifactRequested: false, effort: "medium" }), "low");
check("a roomy one does not", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: TIGHT_OUTPUT_TOKENS, artifactRequested: false, effort: "medium" }), "medium");

/* ---- The dial is the user's ------------------------------------------- */

/* High effort is someone asking for the thorough answer and is theirs to
   spend. The budget still binds; it is simply not this function's place to
   overrule the dial. */
check("high effort still thinks", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: 500, artifactRequested: true, effort: "high" }), "high");
check("low effort never thinks harder", reasoningEffortFor({ route: ROUTES.groqReasoning, outputTokens: roomy, artifactRequested: false, effort: "low" }), "low");

/* ---- The shape that reaches the provider ------------------------------ */

/* `@ai-sdk/openai-compatible` spreads `providerOptions[name]` into the request
   body, where `name` is what the model was created under — the provider id. */
check(
  "keyed by the provider the model was created under",
  reasoningProviderOptions({ route: ROUTES.groqReasoning, outputTokens: 2_000, artifactRequested: true, effort: "medium" }),
  { groq: { reasoning_effort: "low" } }
);

/* ---- It is actually sent --------------------------------------------- */

import { readFileSync } from "node:fs";
const route = readFileSync("app/api/chat/route.ts", "utf8");
check("the chat route asks for it", route.includes("reasoningProviderOptions({"), true);
check("against the route it is really using", /reasoningProviderOptions\(\{[\s\S]{0,120}route: flightRoute/.test(route), true);
check("and the budget it really reserved", /reasoningProviderOptions\(\{[\s\S]{0,200}outputTokens: attemptOutputTokens/.test(route), true);
check("beside the same call's max output", /maxOutputTokens: attemptOutputTokens,[\s\S]{0,900}reasoningProviderOptions/.test(route), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
