/* PATH: tests/route-models.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The half of provider health that nothing checked.
 *
 * `providerProbes` proves a credential works. It says nothing about whether the
 * model ids in `ROUTES` still exist, and this app is built to make that
 * difference invisible: failover is silent by design, a council's 404s are
 * absorbed by `Promise.allSettled`, and the user sees a slightly slower answer
 * from whichever route survived. A routing table pointing at retired models and
 * a set of genuinely weak providers look identical from the outside.
 *
 * The dangerous bug in the checker is not missing a dead id — it is inventing
 * one. A false "these models do not exist" sends someone rewriting a routing
 * table that was never broken, and the two ways to produce one are both pinned
 * here: mangling an id before comparing it, and checking a provider whose
 * catalogue was never fetched.
 */

/* Set before the require below: `ROUTES` reads these at module scope, so a key
   set afterwards would arrive too late to affect what is configured. */
process.env.GROQ_API_KEY = "test-groq-key";
process.env.HF_TOKEN = "test-hf-token";
delete process.env.CEREBRAS_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.MISTRAL_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.TOGETHER_API_KEY;
delete process.env.NVIDIA_API_KEY;
delete process.env.SAMBANOVA_API_KEY;

const { baseModelId, configuredRouteModels } = require("../lib/ai/providers") as typeof import("../lib/ai/providers");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Stripping the routing policy, and nothing else ─────────────────────── */

/* Hugging Face route ids carry `:cheapest` or `:fastest` — an instruction to
   their router, not part of the model's name, and absent from every catalogue.
   Comparing the id with the suffix still attached would report every single HF
   model as missing: a total false alarm, on the largest pool in the table. */
check("the cheapest policy comes off", baseModelId("openai/gpt-oss-120b:cheapest"), "openai/gpt-oss-120b");
check("the fastest policy comes off", baseModelId("deepseek-ai/DeepSeek-V3.2:fastest"), "deepseek-ai/DeepSeek-V3.2");

/* The opposite mistake, and the more subtle one. OpenRouter's `:free` suffix
   *is* part of the model's identity — it is what makes the request free — so a
   greedy "strip everything after the colon" would compare against an id the
   catalogue does not list, and invent a dead route out of a working one. */
check("a free-tier suffix is part of the id and survives",
  baseModelId("deepseek/deepseek-r1:free"), "deepseek/deepseek-r1:free");
check("so does a coding model's free suffix",
  baseModelId("qwen/qwen-2.5-coder-32b-instruct:free"), "qwen/qwen-2.5-coder-32b-instruct:free");
check("an id with no suffix is untouched", baseModelId("llama-3.3-70b"), "llama-3.3-70b");

/* ── Only what this deployment would actually send ──────────────────────── */

const configured = configuredRouteModels();
const providers = configured.map((entry) => entry.provider).sort();

/* A model id cannot be verified against a catalogue we hold no key for, and
   reporting it as unverified on every deployment that simply does not use that
   provider is noise that trains an operator to ignore the check. */
check("only providers holding a credential are listed", providers, ["groq", "huggingface"]);
check("a provider without a key is absent", providers.includes("cerebras" as never), false);

const hf = configured.find((entry) => entry.provider === "huggingface");
check("the Hugging Face pool is present", Boolean(hf?.models.length), true);
check("and no id in it still carries a routing policy",
  hf?.models.some((model) => /:(?:cheapest|fastest)$/.test(model)), false);

const groq = configured.find((entry) => entry.provider === "groq");
check("Groq's configured ids are collected", Boolean(groq?.models.length), true);
check("and are deduplicated — three routes share gpt-oss-120b",
  groq?.models.length, new Set(groq?.models).size);

/* The frontier route ships deliberately unset, because it is the one route that
   can bill. An empty id means "no route configured", and reporting it as a
   model the provider does not serve would be a permanent false failure on every
   deployment that has not opted in. */
check("an unset route contributes no id",
  configured.every((entry) => entry.models.every((model) => model.length > 0)), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
