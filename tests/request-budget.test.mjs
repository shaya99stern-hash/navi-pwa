import { read } from "./source.mjs";

/**
 * The wiring that makes the budget real.
 *
 * `request-size.test.ts` proves the measurements are right. This proves the
 * chat route actually uses them — which is the half that was missing before,
 * since a correct budget nothing consults is exactly what `CONTEXT_INPUT_SHARE`
 * already was. Its own comment admitted that the system prompt, retrieved
 * files, documents, tool schemas and the reply "all come out of the same
 * window, and none of them is counted", and then multiplied by 0.6 and hoped.
 */

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const chat = read("app/api/chat/route.ts");
const registry = read("lib/ai/provider-registry.ts");
const health = read("lib/ai/provider-health.ts");
const models = read("app/api/models/route.ts");

/* ── The output reservation is sized, never flat ────────────────────────── */

/* The single line that broke production. A flat 8,000-token reservation is the
   whole of Groq's free-tier per-minute allowance, so every request — including
   a one-word question — was over the limit before the prompt was counted. */
check("the output cap is no longer a flat constant",
  /maxOutputTokens: MAX_OUTPUT_TOKENS/.test(chat.code), false);
check("it is sized per attempt",
  /maxOutputTokens: attemptOutputTokens/.test(chat.code), true);
check("from what the route has left after the prompt",
  /attemptOutputTokens = Math\.min\(MAX_OUTPUT_TOKENS, ceiling - input\.total\)/.test(chat.code), true);
check("with a floor, so a route is never sent a request it cannot answer",
  /attemptOutputTokens < MIN_OUTPUT_TOKENS/.test(chat.code), true);

/* ── The budget counts the whole payload ────────────────────────────────── */

check("the ceiling comes from the provider, not the context window alone",
  /requestTokenCeiling\(PROVIDERS\[attempt\.provider\]\)/.test(chat.code), true);
check("a safety margin is held back from it",
  /provisionalCeiling = requestTokenCeiling\([^)]*\) - CEILING_SAFETY_MARGIN/.test(chat.code), true);
/* The two contributors the old budget ignored, which together were most of the
   payload: ~9,900 tokens of system prompt and ~2,000 of tool schemas. */
check("the system prompt is measured before the request is sent",
  /estimateTextTokens\(attemptSystem\)/.test(chat.code), true);
check("so are the tool schemas",
  /estimateToolTokens\(attemptTools\)/.test(chat.code), true);
check("and compaction is given the budget that remains",
  /ceiling - fixed - MIN_OUTPUT_TOKENS/.test(chat.code), true);

/* The system prompt has to be built before it can be weighed. Inlining it back
   into the `streamText` call would silently restore the blind spot. */
check("the prompt is built where it can be measured",
  /const systemFor = /.test(chat.code), true);
check("and the stream is handed the measured string",
  /system: attemptSystem,/.test(chat.code), true);

/* ── An impossible request is not offered to a route that must refuse it ── */

check("a route without room is skipped rather than tried",
  /Navi Soul skipped \$\{attempt\.label\}/.test(chat.source), true);
check("the skip says what the payload weighed",
  /Navi Soul skipped \$\{attempt\.label\}: \$\{describeRequestSize\(/.test(chat.source), true);
/* A route with no room must be rejected before compaction, not left to the
   arithmetic — otherwise it reaches the provider with an empty message list,
   which is the whole system prompt and no question, and gets answered. */
check("a route with no room is skipped before the messages are fitted",
  /if \(inputBudget <= 0\) \{ tooSmall\(fixed\); continue; \}/.test(chat.code), true);
/* The failure must reach the user as a size problem, not as a retry prompt:
   waiting fixes a rate limit and does nothing for a request that is too big. */
check("and the copy tells them to shrink it, not to retry",
  /too big for the engines available/.test(chat.source), true);
check("the size branch is tested before the rate-limit branch",
  chat.body.indexOf("more room than any configured route") < chat.body.indexOf('lower.includes("429")'), true);

/* ── The cascade ends somewhere ─────────────────────────────────────────── */

/* The floor moved into the planner along with the rest of route selection, so
   this follows it rather than asserting the line that used to hold it. Both
   halves still matter: the planner has to compute a floor, and the route has to
   append it last. The inline form survives only as the non-model safety net. */
const orchestrator = read("lib/ai/navi-soul/orchestrator.ts");
check("the planner computes the metered floor",
  /lastResort: lastResortRoute\(context\.availability, context\.meteredAllowed\)/.test(orchestrator.code), true);
check("a floor is appended after the health ordering",
  /const floor = turnPlan\.kind === "model" \? turnPlan\.lastResort : lastResortRoute\(availability, meteredAllowed\);/.test(chat.code), true);
check("and it is still pushed onto the end of the attempt list",
  /attempts\.push\(floor\)/.test(chat.code), true);
/* The deployment is to be free to run, so the one route that bills cannot be
   what rescues it — the free routes now fit instead. */
check("and it cannot spend without the ledger's permission",
  /if \(!meteredAllowed\) return null;/.test(read("lib/ai/providers.ts").code), true);
check("it is last, so it never displaces a free route",
  /attempts\.push\(floor\)/.test(chat.code), true);
check("and it is not added twice",
  /!attempts\.some\(/.test(chat.code), true);

/* ── Presence is not health ─────────────────────────────────────────────── */

check("the registry separates a request limit from a context window",
  /requestTokenLimit\?: number/.test(registry.code), true);
check("Groq's measured limit is recorded",
  /requestTokenLimit: 8_000/.test(registry.code), true);
check("an operator can override it per provider",
  /NAVI_\$\{adapter\.id\.toUpperCase\(\)\}_TOKEN_LIMIT/.test(registry.code), true);

check("a refused credential is remembered apart from a transient failure",
  /export function rejectedProviders\(\)/.test(health.code), true);
check("and a rate limit is explicitly not one of them",
  /message\.includes\("rate limit"\)[\s\S]{0,40}return false/.test(health.code), true);

check("the models route reports what works, not what is set",
  /providers: usable,/.test(models.code), true);
check("raw presence stays available for the Connectors screen",
  /configured: stack\.providers,/.test(models.code), true);
check("a present-but-refused key is named rather than silently dropped",
  /rejectedCredentials: rejected,/.test(models.code), true);

/* ── The error about the error ──────────────────────────────────────────── */

/* `@ai-sdk/provider-utils` builds its abort error with `new DOMException`, and
   its `delay()` runs on every `smoothStream` chunk and every retry backoff. The
   edge runtime has no constructor for it, so every abort — including the ones
   failover depends on — threw `TypeError: DOMException is not a constructor`. */
check("the shim is imported by the route that streams",
  /import "@\/lib\/ai\/dom-exception";/.test(chat.code), true);
check("before the SDK that needs it",
  chat.source.indexOf('import "@/lib/ai/dom-exception"') < chat.source.indexOf('} from "ai"'), true);

const shim = read("lib/ai/dom-exception.ts");
/* A `typeof` check passes on the edge runtime's non-constructible binding,
   which is the entire case this exists for — so the test is to build one. */
check("it detects the fault by construction, not by typeof",
  /new \(candidate as new/.test(shim.source), true);
check("it carries the name AbortError checks read",
  /this\.name = name/.test(shim.code), true);
check("and leaves a working runtime alone",
  /if \(constructible\(scope\.DOMException\)\) return;/.test(shim.code), true);

/* ── The budget tracks the platform ceiling ─────────────────────────────── */

/* `REQUEST_BUDGET_MS` sat at 52 seconds under a comment describing a 60-second
   edge ceiling, long after `maxDuration` moved to 300. Nothing failed, because
   everything the budget gates is optional: the review rounds, the mission
   steps, the later tool hops all just quietly stopped happening. A stale
   constant with no assertion behind it is invisible until someone reads it.

   These two do not pin a value — they pin the relationship, so the next time
   `maxDuration` moves, the budget has to be considered rather than forgotten. */
const durationMatch = /export const maxDuration = (\d+)/.exec(chat.code);
const budgetMatch = /const REQUEST_BUDGET_MS = ([\d_]+)/.exec(chat.code);
const maxDurationMs = Number(durationMatch?.[1]) * 1_000;
const budgetMs = Number(budgetMatch?.[1].replace(/_/g, ""));

check("both the platform ceiling and the request budget are readable",
  Number.isFinite(maxDurationMs) && Number.isFinite(budgetMs), true);
check("the budget fits inside the ceiling it is measured against",
  budgetMs < maxDurationMs, true);
/* The failure this catches is the budget drifting far below the ceiling, not
   above it — 52s against 300s wasted five sixths of the available wall clock. */
check("and uses most of it, rather than a fraction left over from an old ceiling",
  budgetMs >= maxDurationMs * 0.6, true);

/* ── The prompt does not deny a tool the model is holding ───────────────── */

/* `fetch_url` is registered unconditionally — no key, no toggle. The prompt
   nonetheless told the model "You cannot browse the web in this request"
   whenever no search provider was configured, which is every turn on a
   deployment without a search key. The app spent its own prompt budget talking
   the model out of the one web capability it always has. */
check("the browse instruction is chosen by what is in the toolset",
  /toolNames\.includes\("fetch_url"\)/.test(chat.code), true);
check("no prompt string flatly denies browsing",
  /You cannot browse the web in this request/.test(chat.code), false);
check("the remaining denial covers search and reading together",
  /You cannot search or read web pages in this request/.test(chat.code), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
