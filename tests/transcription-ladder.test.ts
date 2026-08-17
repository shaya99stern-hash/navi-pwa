/* PATH: tests/transcription-ladder.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The provider ladder for speech-to-text.
 *
 * Written against a real failure rather than a hypothetical one. The live
 * diagnostic on this app's own deployment reported the Hugging Face token
 * working and not one of its three whisper models served to the account — so
 * dictation failed on the host, every time, and reached the user as a
 * microphone that did not work.
 *
 * The defect was the shape rather than the ids. Chat survives any single
 * provider changing its catalogue because it ladders across ten of them;
 * transcription was pinned to one, with no path around it. These pin the
 * property that fixes that: a deployment holding a Groq key can transcribe
 * regardless of what Hugging Face will or will not serve.
 */

const { transcriptionCandidates, transcriptionModels } =
  require("../lib/ai/voice/transcription-models") as typeof import("../lib/ai/voice/transcription-models");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const KEYS = ["GROQ_API_KEY", "HF_TOKEN", "HUGGINGFACE_API_KEY", "NAVI_TRANSCRIBE_MODEL"];
function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    for (const key of KEYS) {
      delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  }
}

/* ── Credentials gate the ladder ─────────────────────────────────────────── */

/* A provider with no key is omitted rather than attempted and failed, so the
   failure list a log ever shows contains only real refusals. */
check("no credentials means nothing is attempted", withEnv({}, () => transcriptionCandidates()).length, 0);

/* ── The change that fixes the reported failure ──────────────────────────── */

const groqOnly = withEnv({ GROQ_API_KEY: "k" }, () => transcriptionCandidates());
check("a Groq-only deployment can transcribe", groqOnly.length > 0, true);
check("without needing a Hugging Face token",
  groqOnly.every((candidate) => candidate.provider === "groq"), true);
check("using Groq's own endpoint", groqOnly[0].endpoint.startsWith("https://api.groq.com/"), true);
check("and its own credential", groqOnly[0].token, "k");
/* Groq names whisper bare; the `openai/` prefix is Hugging Face's namespace,
   and sending one host the other's id is a guaranteed refusal. */
check("with an id Groq actually serves", groqOnly[0].model, "whisper-large-v3-turbo");
check("never a Hugging Face-namespaced id",
  groqOnly.some((candidate) => candidate.model.startsWith("openai/")), false);

const hfOnly = withEnv({ HF_TOKEN: "t" }, () => transcriptionCandidates());
check("a Hugging Face-only deployment still works as before", hfOnly.length > 0, true);
check("with the namespaced ids that host expects", hfOnly[0].model, "openai/whisper-large-v3-turbo");
check("against its audio endpoint", hfOnly[0].endpoint.includes("/v1/audio/transcriptions"), true);

/* ── Order is the point ──────────────────────────────────────────────────── */

const both = withEnv({ GROQ_API_KEY: "k", HF_TOKEN: "t" }, () => transcriptionCandidates());
/* Groq leads because it is the fastest configured host for audio and the one
   this app most often holds a working key for. */
check("Groq is tried before Hugging Face", both[0].provider, "groq");
check("and Hugging Face still gets its turn",
  both.some((candidate) => candidate.provider === "huggingface"), true);
check("every Groq attempt precedes every Hugging Face one",
  both.findLastIndex((c) => c.provider === "groq") < both.findIndex((c) => c.provider === "huggingface"), true);
/* Each attempt must carry its own credential: reusing one across hosts is
   exactly the assumption that kept this route on a single provider. */
check("each candidate carries the credential for its own host",
  both.every((candidate) => candidate.token === (candidate.provider === "groq" ? "k" : "t")), true);

/* ── An operator's choice leads, and is not translated ───────────────────── */

const pinned = withEnv(
  { GROQ_API_KEY: "k", HF_TOKEN: "t", NAVI_TRANSCRIBE_MODEL: "distil-whisper-large-v3-en" },
  () => transcriptionCandidates()
);
check("a configured model is attempted first", pinned[0].model, "distil-whisper-large-v3-en");
/* Offered to each host as written rather than rewritten between naming
   schemes: a wrong id costs one failed attempt, where translating it would
   silently send a model nobody asked for. */
check("and offered to Hugging Face as written too",
  pinned.some((c) => c.provider === "huggingface" && c.model === "distil-whisper-large-v3-en"), true);
check("with the defaults still behind it", pinned.length > 2, true);
check("and no duplicate attempt when it matches a default",
  withEnv({ GROQ_API_KEY: "k", NAVI_TRANSCRIBE_MODEL: "whisper-large-v3-turbo" }, () => transcriptionCandidates())
    .filter((c) => c.model === "whisper-large-v3-turbo").length, 1);

/* ── The reporting surface ───────────────────────────────────────────────── */

check("model ids are reported without duplicates for status surfaces",
  withEnv({ GROQ_API_KEY: "k", HF_TOKEN: "t" }, () => transcriptionModels()).length,
  new Set(withEnv({ GROQ_API_KEY: "k", HF_TOKEN: "t" }, () => transcriptionModels())).size);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
