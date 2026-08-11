import { PROVIDERS, requestTokenCeiling } from "@/lib/ai/provider-registry";
import { describeRequestSize, estimateTextTokens, estimateToolTokens, measureRequest } from "@/lib/ai/request-size";
import { isCredentialRejection, markProviderFailure, markProviderSuccess, rejectedProviders, resetProviderHealth } from "@/lib/ai/provider-health";
import { lastResortRoute } from "@/lib/ai/providers";
import { fitReferenceBlocks } from "@/lib/ai/prompt/base";
import type { ProviderAvailability } from "@/lib/ai/providers";
import type { ModelMessage, ToolSet } from "ai";

/**
 * The request that could never have succeeded.
 *
 * Production returned "Navi Soul has no working credential to answer with" on
 * every turn. The credential was fine. One request, verbatim from the runtime
 * log, explains it:
 *
 *   Groq openai/gpt-oss-120b  AI_APICallError: Request too large ... service
 *   tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 20805
 *
 * The turn was 2.6x the entire per-minute allowance of the route it was sent
 * to. No retry and no failover can fix a request that is structurally too big,
 * and the app had no way to see that it was — the only budget it kept measured
 * the message history, and the message history was the small part.
 */

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── A throughput limit is not a context window ─────────────────────────── */

check("Groq's ceiling is its per-minute allowance, not its context window",
  requestTokenCeiling(PROVIDERS.groq), 8_000);
check("the context window it advertises is still much larger",
  PROVIDERS.groq.contextWindow, 131_072);
/* Every other provider is left alone deliberately: inventing a limit from
   memory would re-create the original bug with a different number. */
check("a provider with no measured limit falls back to its window",
  requestTokenCeiling(PROVIDERS.gemini), PROVIDERS.gemini.contextWindow);

process.env.NAVI_GROQ_TOKEN_LIMIT = "30000";
check("an operator can widen a wrong limit without a deploy",
  requestTokenCeiling(PROVIDERS.groq), 30_000);
process.env.NAVI_GROQ_TOKEN_LIMIT = "999999999";
/* An override larger than the window is not a permission — it is a request
   that gets silently truncated by the provider. */
check("but never past the model's actual context window",
  requestTokenCeiling(PROVIDERS.groq), 131_072);
process.env.NAVI_GROQ_TOKEN_LIMIT = "nonsense";
check("an unparseable override falls back to the measured limit",
  requestTokenCeiling(PROVIDERS.groq), 8_000);
delete process.env.NAVI_GROQ_TOKEN_LIMIT;

/* ── Everything in the payload is counted, not just the messages ────────── */

const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(400) }];
const tools = {
  diagnose_self: { description: "y".repeat(400) },
  run_javascript: { description: "z".repeat(400) }
} as unknown as ToolSet;

const size = measureRequest({ system: "s".repeat(4_000), tools, messages, output: 2_000 });
check("the system prompt is counted", size.system, 1_000);
check("the tool schemas are counted", size.tools > 0, true);
check("the messages are counted", size.messages, 100);
/* Counted because the provider counts it. Groq bills input plus reserved
   `max_tokens` against the same per-minute window, which is how a flat
   8,000-token reservation consumed the entire allowance before the prompt was
   even added. */
check("the reserved output is counted", size.output, 2_000);
check("the total is the sum of every part",
  size.total, size.system + size.tools + size.messages + size.output);

check("an empty toolset costs nothing", estimateToolTokens({} as ToolSet), 0);
check("text estimates at four characters to a token", estimateTextTokens("a".repeat(1_000)), 250);

/* ── The log line has to name what to shrink ────────────────────────────── */

const described = describeRequestSize(measureRequest({
  system: "s".repeat(40_000), tools: {} as ToolSet, messages, output: 1_000
}), 8_000);
check("the breakdown names the largest contributor", /largest is system/.test(described), true);
check("it reports the ceiling it was measured against", /against a 8000 ceiling/.test(described), true);

/* ── The observed failure, reconstructed ────────────────────────────────── */

/* Roughly the shape measured on this codebase: ~9,900 tokens of system prompt
   when every optional block loads, ~2,000 of tool schemas, and the old flat
   8,000 output reservation. The user's message is almost irrelevant to it. */
const observed = measureRequest({
  system: "s".repeat(9_900 * 4), tools, messages, output: 8_000
});
check("the reconstructed turn overruns Groq's ceiling as it did in production",
  observed.total > requestTokenCeiling(PROVIDERS.groq), true);
/* And the point of the fix: with the output sized to what is left rather than
   reserved flat, the same prompt on a light turn fits. */
const lightTurn = measureRequest({ system: "s".repeat(1_600 * 4), tools: {} as ToolSet, messages, output: 0 });
check("a light turn leaves real room for a reply under the same ceiling",
  requestTokenCeiling(PROVIDERS.groq) - lightTurn.total > 4_000, true);

/* ── A rejected key is not a busy one ───────────────────────────────────── */

check("403 is a rejected credential", isCredentialRejection(new Error("AI_APICallError: Forbidden (403)")), true);
check("401 is a rejected credential", isCredentialRejection(new Error("401 Unauthorized")), true);
check("invalid api key is a rejected credential", isCredentialRejection(new Error("Invalid API key provided")), true);
/* The one that matters most. Being rate-limited is proof the key is *good*,
   and treating it as dead would retire a working provider. */
check("429 is not a rejected credential", isCredentialRejection(new Error("429 Too Many Requests")), false);
check("a rate limit is not a rejected credential", isCredentialRejection(new Error("Rate limit reached for model")), false);
check("a timeout is not a rejected credential", isCredentialRejection(new Error("The operation timed out")), false);
check("nothing at all is not a rejected credential", isCredentialRejection(undefined), false);

resetProviderHealth();
markProviderFailure("cerebras", new Error("AI_APICallError: Forbidden"));
check("a dead key is remembered after a single refusal", rejectedProviders(), ["cerebras"]);
/* One 403 is enough to stop trying it first. Waiting for a second failure
   spends another request to confirm what the provider already said plainly. */
markProviderFailure("groq", new Error("429 rate limit"));
check("a rate-limited provider is not marked rejected", rejectedProviders(), ["cerebras"]);
markProviderSuccess("cerebras");
check("a replaced key clears on its first real use", rejectedProviders(), []);
resetProviderHealth();

/* ── The failover has a floor ───────────────────────────────────────────── */

const availability = { openrouter: true } as unknown as ProviderAvailability;
delete process.env.NAVI_FRONTIER_MODEL;
check("no floor when no frontier model is named", lastResortRoute(availability, true), null);
process.env.NAVI_FRONTIER_MODEL = "anthropic/claude-opus-5";
check("no floor without the key that reaches it",
  lastResortRoute({ openrouter: false } as unknown as ProviderAvailability, true), null);
/* The deployment is to be free to run, so the one route that bills cannot be
   what rescues it. The ledger treats an unreadable store as exhausted, which
   means a storage outage degrades to free rather than to unlimited billing. */
check("no floor when the ledger has not authorised spending",
  lastResortRoute(availability, false), null);
const floor = lastResortRoute(availability, true);
check("a deployment that opted in still gets one", floor?.provider, "openrouter");
delete process.env.NAVI_FRONTIER_MODEL;

/* ── The reference blocks compete for room instead of each deciding alone ── */

/* Measured on this codebase, and the reason the free tier could not be served:
   APP_KNOWLEDGE 2,159 tokens, CODE_CRAFT 2,837, ENGINEERING_DISCIPLINE 1,993,
   ORCHESTRATION_KNOWLEDGE 978, NAVI_MISSION 841. Every predicate admitting one
   is individually reasonable; nothing counted them together. */
const block = (name: string, tokens: number) => ({ name, text: "x".repeat(tokens * 4) });
const candidates = [
  block("self-repo", 60),
  block("app-knowledge", 2_159),
  block("engineering-discipline", 1_993),
  block("code-craft", 2_837),
  block("mission", 841),
  block("orchestration", 978)
];

const roomy = fitReferenceBlocks(candidates, Number.POSITIVE_INFINITY);
check("a roomy route drops nothing", roomy.dropped, []);
check("and keeps every block it was given", roomy.kept.length, 6);

/* The two budgets Groq's free tier actually produces, after the reserve for
   prefix, tools, conversation and reply: 3,100 for an ordinary chat turn with
   about a dozen tools, 2,100 for a code turn carrying all twenty-two. */

const chatTurn = fitReferenceBlocks(candidates, 3_100);
check("an ordinary free-tier turn keeps which repository this app is",
  chatTurn.kept[0].length, 60 * 4);
check("and the app description, which is the answer when the question is about the app",
  chatTurn.kept[1].length, 2_159 * 4);
check("routing knowledge is the first thing dropped",
  chatTurn.dropped.includes("orchestration"), true);
check("and the two largest code blocks go with it",
  chatTurn.dropped.includes("code-craft") && chatTurn.dropped.includes("engineering-discipline"), true);

/* A code turn carries ten more tool schemas, so the background budget is
   smaller — and what survives changes to match. The app description losing to
   the code-conduct block here is the right trade: this is a turn holding the
   commit tools, where how to change code without breaking it matters more than
   how the product is described. */
const codeTurn = fitReferenceBlocks(candidates, 2_100);
check("a crowded code turn keeps the code conduct rules instead",
  codeTurn.kept[1].length, 1_993 * 4);
check("and drops the app description it can no longer afford",
  codeTurn.dropped.includes("app-knowledge"), true);
check("either way the tiny load-bearing block always survives",
  [chatTurn, codeTurn].every((fit) => fit.kept[0].length === 60 * 4), true);

/* A block that does not fit must not stop the scan: a small low-priority block
   should still get in behind a large one that was refused, and stopping would
   spend the rest of the budget on nothing. */
const scan = fitReferenceBlocks([block("huge", 5_000), block("tiny", 100)], 1_000);
check("a refused block does not end the scan", scan.kept.length, 1);
check("the small one behind it still fits", scan.dropped, ["huge"]);

/* Whole or not at all. Half a reference is not a smaller reference — it is a
   truncated instruction that reads as complete. */
check("nothing is admitted partially",
  fitReferenceBlocks([block("one", 5_000)], 4_999).kept, []);
check("an empty block costs nothing and is not reported as dropped",
  fitReferenceBlocks([{ name: "absent", text: "" }], 0), { kept: [], dropped: [] });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
