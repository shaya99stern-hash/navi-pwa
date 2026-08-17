/* PATH: tests/tts-budget.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The ceiling on premium speech, which is the only part of that file that can
 * cost money.
 *
 * This is the first metered thing in the app that is not a model call, and it
 * has the worst failure shape of any of them: a hands-free loop generates
 * speech continuously, with nobody pressing send, so an unguarded integration
 * bills for as long as the tab is open. Every refusal below is a refusal that
 * has to happen *before* the request, because a guard that runs afterwards is
 * an invoice with extra steps.
 */

const tts = require("../lib/ai/voice/tts") as typeof import("../lib/ai/voice/tts");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* The in-memory ledger the spend store falls back to without KV credentials.
   Reset between cases so one test's spending is not another's starting point. */
const ledger = () => (globalThis as { __naviSpendLedger?: Map<string, number> }).__naviSpendLedger;
const resetLedger = () => ledger()?.clear();
const charged = () => ledger()?.get(tts.ttsLedgerKey()) ?? 0;

const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  return new Response(new ReadableStream(), { status: 200, headers: { "content-type": "audio/mpeg" } });
}) as typeof fetch;

async function main() {
  /* ---- No credential is not a failure, it is the default deployment ----- */

  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.NAVI_TTS_VOICE_ID;
  resetLedger();
  fetchCalls = 0;

  check("premium speech is off without a credential", tts.ttsConfigured(), false);
  const unconfigured = await tts.synthesizeSpeech({ text: "Hello there." });
  check("and refuses rather than throwing", unconfigured.ok, false);
  check("naming the reason", !unconfigured.ok && unconfigured.reason, "unconfigured");
  /* The property that matters most on this path: an unconfigured deployment
     must behave exactly as it does today, which means touching nothing. */
  check("no request is made", fetchCalls, 0);
  check("and nothing is charged", charged(), 0);

  /* ---- Refusals that must happen before the request ---------------------- */

  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.NAVI_TTS_VOICE_ID = "test-voice";
  process.env.NAVI_TTS_MONTHLY_CHARS = "1000";
  resetLedger();
  fetchCalls = 0;

  const empty = await tts.synthesizeSpeech({ text: "   " });
  check("empty text is refused", !empty.ok && empty.reason, "empty");
  check("without a request", fetchCalls, 0);
  check("and without a charge", charged(), 0);

  const long = await tts.synthesizeSpeech({ text: "x".repeat(801) });
  check("an utterance past the spoken limit is refused", !long.ok && long.reason, "too-long");
  /* Voice mode speaks summaries; a reply this long is one the spoken track
     should have shortened rather than narrated. */
  check("still without a request", fetchCalls, 0);
  check("still without a charge", charged(), 0);

  /* ---- The budget, and the order it is enforced in ----------------------- */

  resetLedger();
  fetchCalls = 0;
  const first = await tts.synthesizeSpeech({ text: "y".repeat(600) });
  check("a request inside the budget is allowed", first.ok, true);
  check("and is charged for what it will speak", charged(), 600);
  check("and reports what it charged", first.ok && first.charged, 600);

  /* The concurrency property, exercised sequentially: characters are reserved
     *before* the call, so a second utterance sees the first one's spending. A
     guard that billed afterwards would let both through. */
  const second = await tts.synthesizeSpeech({ text: "z".repeat(600) });
  check("the next utterance sees the first one's spending", !second.ok && second.reason, "budget-exhausted");
  check("and is not sent", fetchCalls, 1);

  /* ---- A zero budget is a hard off switch ------------------------------- */

  process.env.NAVI_TTS_MONTHLY_CHARS = "0";
  resetLedger();
  fetchCalls = 0;
  const zero = await tts.synthesizeSpeech({ text: "Anything at all." });
  check("a zero budget refuses everything", !zero.ok && zero.reason, "budget-exhausted");
  check("without a request", fetchCalls, 0);
  check("and without reserving characters", charged(), 0);

  /* ---- Configuration ---------------------------------------------------- */

  delete process.env.NAVI_TTS_MONTHLY_CHARS;
  check("the default budget is the vendor's free tier", tts.monthlyCharBudget(), 10_000);
  process.env.NAVI_TTS_MONTHLY_CHARS = "not a number";
  check("an unparseable budget falls back rather than becoming zero or NaN", tts.monthlyCharBudget(), 10_000);
  process.env.NAVI_TTS_MONTHLY_CHARS = "-5";
  check("a negative budget is refused the same way", tts.monthlyCharBudget(), 10_000);
  process.env.NAVI_TTS_MONTHLY_CHARS = "25000";
  check("an operator can raise it deliberately", tts.monthlyCharBudget(), 25_000);

  /* Keyed by month so the allowance resets with the vendor's billing period. */
  check("the ledger key is monthly and namespaced",
    tts.ttsLedgerKey(new Date(Date.UTC(2026, 7, 17))), "navi:tts:chars:2026-08");
  check("and pads a single-digit month",
    tts.ttsLedgerKey(new Date(Date.UTC(2026, 0, 3))), "navi:tts:chars:2026-01");

  /* ---- What is worth telling the user ----------------------------------- */

  /* Falling back to the on-device voice is a different timbre, not a failure.
     Narrating it every turn would be worse than the thing it reports. */
  check("a slow provider is not announced", tts.refusalWorthSurfacing("too-slow"), false);
  check("nor is an unconfigured one", tts.refusalWorthSurfacing("unconfigured"), false);
  check("nor a provider that failed", tts.refusalWorthSurfacing("provider-failed"), false);
  /* A spent budget persists for the rest of the month and can be acted on. */
  check("a spent budget is", tts.refusalWorthSurfacing("budget-exhausted"), true);

  /* ---- Usage reporting -------------------------------------------------- */

  process.env.NAVI_TTS_MONTHLY_CHARS = "1000";
  resetLedger();
  await tts.synthesizeSpeech({ text: "w".repeat(400) });
  const usage = await tts.readTtsUsage();
  check("usage reports what has been spoken", usage.used, 400);
  check("and what is left", usage.remaining, 600);

  globalThis.fetch = realFetch;
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().catch((error) => { globalThis.fetch = realFetch; console.error(error); process.exit(1); });

export {};
