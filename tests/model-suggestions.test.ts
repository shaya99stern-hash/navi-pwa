/* PATH: tests/model-suggestions.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * Naming a replacement for a model id a provider no longer serves.
 *
 * The diagnostic already fetches each catalogue in order to detect the
 * mismatch, so the answer is in hand at the moment the problem is found.
 * Reporting only that six ids are wrong sends the operator off to fetch six
 * catalogues by hand — which is the errand that let this table rot in the
 * first place, and the errand they would have to run again on the next
 * rotation.
 *
 * The cases below are the real ones from the owner's live deployment, matched
 * against catalogue shapes those providers plausibly return. They pin two
 * things: that the common failure — a provider renaming or re-namespacing a
 * model that is still there — produces the right candidate, and that a model
 * genuinely absent produces nothing rather than a confident wrong answer.
 */

const { suggestReplacements } = require("../lib/ai/diagnostic-tools") as typeof import("../lib/ai/diagnostic-tools");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Punctuation moved, model did not ────────────────────────────────────── */

/* Reported live as unreachable on Cerebras. The catalogue spells it without
   the separator, which is the single most common shape of this failure. */
const cerebras = new Set(["llama3.3-70b", "llama3.1-8b", "qwen-3-32b", "gpt-oss-120b"]);
check("a renamed separator is found", suggestReplacements("llama-3.3-70b", cerebras)[0], "llama3.3-70b");
check("and an exact-name sibling is not confused with it",
  suggestReplacements("llama3.1-8b", cerebras)[0], "llama3.1-8b");

/* ── Namespace moved ─────────────────────────────────────────────────────── */

const nvidia = new Set(["deepseek-ai/deepseek-r1-distill-llama-8b", "meta/llama-3.3-70b-instruct"]);
check("a re-namespaced model is found",
  suggestReplacements("deepseek-ai/deepseek-r1", nvidia)[0], "deepseek-ai/deepseek-r1-distill-llama-8b");

/* ── Version moved, suffix kept ──────────────────────────────────────────── */

const openrouter = new Set(["deepseek/deepseek-r1-0528:free", "qwen/qwen3-coder:free", "z-ai/glm-4.5-air:free"]);
check("a dated rebuild of the same model is found",
  suggestReplacements("deepseek/deepseek-r1:free", openrouter)[0], "deepseek/deepseek-r1-0528:free");
/* The `:free` suffix is shared by every entry, so matching on it alone would
   rank an unrelated model first. The coder model has to win on "qwen" and
   "coder", not on "free". */
check("a shared suffix does not decide the ranking",
  suggestReplacements("qwen/qwen-2.5-coder-32b-instruct:free", openrouter)[0], "qwen/qwen3-coder:free");

/* ── Silence beats a confident wrong answer ──────────────────────────────── */

/* A model that is genuinely gone, in a catalogue with nothing like it. An
   operator who pastes a suggestion is trusting it, so an unrelated id offered
   here is worse than no suggestion at all. */
check("an unrelated catalogue yields no suggestion",
  suggestReplacements("mistralai/Mistral-Small-24B-Instruct-2501", new Set(["gpt-oss-120b", "llama3.1-8b"])), []);
check("an empty catalogue yields no suggestion", suggestReplacements("llama-3.3-70b", new Set()), []);
check("an id with no usable fragments yields no suggestion",
  suggestReplacements("--", new Set(["llama3.3-70b"])), []);

/* ── Bounded and ordered ─────────────────────────────────────────────────── */

const many = new Set([
  "llama-3.3-70b-instruct", "llama-3.3-70b-versatile", "llama-3.3-70b-specdec", "llama-3.1-70b", "llama-3.3-8b"
]);
const suggestions = suggestReplacements("llama-3.3-70b", many);
/* Two is a choice to check, not a list to wade through. */
check("no more than two are offered", suggestions.length <= 2, true);
check("and every one is genuinely in the catalogue",
  suggestions.every((id) => many.has(id)), true);
/* The case that exposed a real flaw while this test was being written.
   Splitting on every non-alphanumeric turned `llama-3.3-70b` into "llama",
   "3", "3", "70b", the single characters were dropped as noise, and the
   version went with them — so `llama-3.1-70b` outranked every 3.3 build. A
   different model, offered to someone who would have pasted it in. */
check("the suggested model is the right version", suggestions[0].includes("3.3"), true);
check("and never a different point release", suggestions.some((id) => id.includes("3.1")), false);
check("matching is case-insensitive",
  suggestReplacements("Mistral-Small-24B", new Set(["mistralai/mistral-small-24b-instruct"]))[0],
  "mistralai/mistral-small-24b-instruct");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
