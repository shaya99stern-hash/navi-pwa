/**
 * Every name a credential has ever been given here still finds it.
 *
 * `providerApiKey` widens in three passes: the exact names in `envKeys`, then
 * any variable whose name identifies the provider and looks like a secret,
 * then any value carrying a recognisable key prefix. The second pass makes
 * most of the first redundant — `HUGGINGFACE_ACCESS_TOKEN` is found by the
 * predicate whether or not it is also written out — and forty-seven names
 * accumulated in the list anyway, eleven of them Hugging Face spellings that
 * differ only in an underscore.
 *
 * A long list is not free. It reads as though each entry is load bearing, so
 * nobody trims it, and the ones that genuinely are — an account that named its
 * variable `fable_read_Hugging_face` — are invisible among the ones that are
 * not.
 *
 * This file is what makes trimming safe. Every name below has at some point
 * been the name in someone's environment, so every one must keep resolving,
 * whichever pass ends up doing the work. Delete a line from `envKeys` and this
 * says immediately whether the predicate caught it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { PROVIDERS, PROVIDER_IDS, providerApiKey } from "@/lib/ai/provider-registry";
import type { ProviderName } from "@/lib/ai/types";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = `${dir}/${entry}`;
  return statSync(path).isDirectory() ? walk(path) : [path];
});

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/** Every spelling this repo has ever read, by the provider it belongs to. */
const HISTORICAL: Record<ProviderName, string[]> = {
  gemini: ["GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY", "GROQ_API", "GROQ_KEY", "GROQ_TOKEN", "GROQ_API_TOKEN", "GROQ_SECRET_KEY"],
  huggingface: [
    "HF_TOKEN", "HUGGING_FACE_FINE_GRAINED_API", "fable_read_Hugging_face", "HUGGING_FACE_API_Write",
    "HF_API_TOKEN", "HF_API_KEY", "HF_ACCESS_TOKEN", "HUGGINGFACE_API_KEY", "HUGGING_FACE_API_KEY",
    "HUGGINGFACE_TOKEN", "HUGGING_FACE_TOKEN", "HUGGINGFACE_HUB_TOKEN", "HUGGING_FACE_HUB_TOKEN",
    "HUGGINGFACE_ACCESS_TOKEN", "HUGGING_FACE_ACCESS_TOKEN"
  ],
  cerebras: ["CEREBRAS_API_KEY", "CEREBRAS_KEY", "CEREBRAS_API_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY", "OPENROUTER_KEY", "OPENROUTER_TOKEN"],
  deepseek: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY", "DEEPSEEK_API_TOKEN"],
  mistral: ["MISTRAL_API_KEY", "MISTRAL_KEY", "MISTRAL_API_TOKEN"],
  together: ["TOGETHER_API_KEY", "TOGETHER_KEY", "TOGETHER_API_TOKEN"],
  nvidia: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NIM_API_KEY"],
  sambanova: ["SAMBANOVA_API_KEY", "SAMBANOVA_KEY"]
};

/* The deployment's own keys are in this process's environment and would be
   found by the widening passes, so every assertion below would pass without
   reading the variable it is about. Cleared for the run, restored after. */
const saved = { ...process.env };
const clearEnvironment = () => {
  for (const name of Object.keys(process.env)) {
    const upper = name.toUpperCase();
    if (/KEY|TOKEN|SECRET|API|HF|HUGGING|GROQ|GEMINI|GOOGLE|CEREBRAS|ROUTER|DEEPSEEK|MISTRAL|TOGETHER|NVIDIA|NIM|SAMBANOVA|FABLE/.test(upper)) {
      delete process.env[name];
    }
  }
};
clearEnvironment();

check("every provider is covered by this file", PROVIDER_IDS.filter((id) => !HISTORICAL[id]), []);

const SECRET = "sk-test-value-1234567890";
for (const id of PROVIDER_IDS) {
  for (const name of HISTORICAL[id]) {
    clearEnvironment();
    process.env[name] = SECRET;
    check(`${name} resolves to ${id}`, providerApiKey(PROVIDERS[id]), SECRET);
    /* And to nothing else. A name broad enough to be claimed by two providers
       is how one provider's key ends up sent to another's endpoint. */
    const claimants = PROVIDER_IDS.filter((other) => providerApiKey(PROVIDERS[other]) === SECRET);
    check(`${name} belongs to ${id} alone`, claimants, [id]);
  }
}

/* ---- The passes that do the widening --------------------------------- */

clearEnvironment();
/* A name nobody anticipated, which is the whole reason the second pass
   exists: keys get pasted into a variable named whatever the person was
   thinking at the time. */
process.env.MY_PERSONAL_GROQ_API_KEY_FOR_NAVI = SECRET;
check("an unanticipated name is still found", providerApiKey(PROVIDERS.groq), SECRET);

clearEnvironment();
/* The last resort: the name says nothing, the value says everything. */
process.env.SOME_RANDOM_VARIABLE = "hf_abcdefghijklmnop";
check("a key is recognised by its prefix", providerApiKey(PROVIDERS.huggingface), "hf_abcdefghijklmnop");

clearEnvironment();
/* Placeholders are not credentials. Reporting a provider as configured
   because someone left `your_key` in an example file is worse than reporting
   it as missing. */
for (const placeholder of ["undefined", "null", "none", "changeme", "your_key", "YOUR-KEY", "  "]) {
  process.env.GROQ_API_KEY = placeholder;
  check(`"${placeholder.trim() || "(blank)"}" is not a credential`, providerApiKey(PROVIDERS.groq), undefined);
}

clearEnvironment();
check("no key at all means no key", providerApiKey(PROVIDERS.groq), undefined);

/* ---- Priority ---------------------------------------------------------- */

clearEnvironment();
/* Two names, one provider. The canonical one wins, or a stale alias left over
   from an earlier deployment silently outranks the key someone just set. */
process.env.GROQ_KEY = "stale-alias";
process.env.GROQ_API_KEY = "the-current-one";
check("the canonical name wins", providerApiKey(PROVIDERS.groq), "the-current-one");

for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, saved);

/* ---- One lookup, not two ---------------------------------------------- */

/* `image-generation.ts` carried a byte-for-byte copy of this whole mechanism:
   its own `usableSecret`, its own key normaliser, its own three-pass search,
   and the full list of spellings for two providers written out a second time.
   Free to drift, and nothing compared them — a deployment whose key the chat
   route found and this one did not would read as the image feature being
   broken rather than as two tables disagreeing. */
const imageGeneration = readFileSync("lib/ai/image-generation.ts", "utf8");
check("image generation reads the shared table", imageGeneration.includes("providerApiKey(PROVIDERS.huggingface)"), true);
/* The definition, not the name — the note explaining the removal mentions
   it, and this repo has now tripped its own negative assertions on its own
   comments three separate times. */
check("and does not keep its own search", imageGeneration.includes("function findEnvironmentSecret"), false);
check("nor its own placeholder rule", imageGeneration.includes("changeme"), false);
check("nor its own list of spellings", imageGeneration.includes("HUGGING_FACE_HUB_TOKEN"), false);

/* The registry is the only place in the app that names an environment
   variable for a model provider. A second list anywhere is the bug above,
   waiting to happen again. */
const stray = walk("lib")
  .concat(walk("app"))
  .filter((path) => (path.endsWith(".ts") || path.endsWith(".tsx")) && !path.endsWith("provider-registry.ts"))
  /* Credentials only. `GROQ_FAST_MODEL` and `HF_ROUTING_POLICY` name the same
     providers and are settings rather than secrets — an operator override of
     which model to call, which belongs beside the route that calls it. */
  .filter((path) => /process[.]env[.](?:HF|HUGGING\w*|GROQ|GEMINI|GOOGLE|CEREBRAS|OPENROUTER|DEEPSEEK|MISTRAL|TOGETHER|NVIDIA|NIM|SAMBANOVA)_(?:API_)?(?:KEY|TOKEN|SECRET)\b/.test(readFileSync(path, "utf8")));
check("no file names a provider credential directly", stray, []);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
