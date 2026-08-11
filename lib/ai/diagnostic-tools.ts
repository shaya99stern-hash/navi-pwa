import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Letting Navi Soul find out what is actually wrong with itself.
 *
 * Every diagnosis in this app's history has been made by a human reading source
 * code, and the model's contribution was to guess. Asked why skills would not
 * save, it blamed Supabase connectivity and then declared the capability
 * impossible — both invented, because the only thing it could observe was that
 * a tool had returned "no". Asked which repository it lives in, it invented one.
 * Asked where a setting had moved, it invented a menu path.
 *
 * The pattern is always the same and it is not the model being careless: a
 * question about the running system, and no way to look. A model with no
 * observation and a question it is expected to answer will produce an answer.
 *
 * So this is the eyes. Each check performs a real operation against the real
 * service and reports what came back, including the failure text. Nothing here
 * infers, and nothing reports "configured" as though it meant "working" — the
 * distinction that hid a dead transcription token for days.
 */

const TIMEOUT_MS = 10_000;

export type DiagnosticResult = {
  area: string;
  ok: boolean;
  detail: string;
};

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, onTimeout: () => T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch {
    return onTimeout();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Can this user's cloud memory actually be read and written?
 *
 * The check that would have saved a week. The tables exist and the migration is
 * applied, so every static inspection says memory is fine — while every write
 * is refused, because the policies compare `user_id` against
 * `auth.jwt() ->> 'sub'` and Supabase cannot verify the Clerk token. A read
 * that returns 401 says that in one call; nothing short of a real request can.
 */
async function checkCloudMemory(clerkToken?: string): Promise<DiagnosticResult> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? ""
  ).trim();

  if (!url || !key) return { area: "Cloud memory", ok: false, detail: "Not configured on this deployment: no Supabase URL or anon key." };
  if (!clerkToken) return { area: "Cloud memory", ok: false, detail: "Nobody is signed in, so there is no account to read memory for." };

  return withTimeout(
    async (signal) => {
      const response = await fetch(`${url}/rest/v1/navi_learned_skills?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${clerkToken}` },
        signal,
        cache: "no-store"
      });
      if (response.ok) return { area: "Cloud memory", ok: true, detail: "Readable and writable. Skills, chats, and preferences will persist." };
      const body = (await response.text().catch(() => "")).slice(0, 240);
      /* The three failures, each with a different fix, and none of them
         guessable from the status code alone. */
      if (response.status === 404) {
        return { area: "Cloud memory", ok: false, detail: `The tables do not exist on this Supabase project — the migration in supabase/migrations has not been applied. (404 ${body})` };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          area: "Cloud memory",
          ok: false,
          detail: `Supabase rejected the sign-in token (${response.status}). The tables exist, so this is Supabase not trusting Clerk: add Clerk as a third-party auth provider in the Supabase project, and enable the Supabase integration in Clerk so the token carries the expected claims. Until then every policy compares against a null user and refuses everything. (${body})`
        };
      }
      return { area: "Cloud memory", ok: false, detail: `Supabase answered ${response.status}. ${body}` };
    },
    () => ({ area: "Cloud memory", ok: false, detail: "Supabase did not answer within 10 seconds." })
  );
}

/** Does the transcription credential actually work, rather than merely exist? */
async function checkTranscription(): Promise<DiagnosticResult> {
  const token = (process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY ?? "").trim();
  if (!token) return { area: "Voice transcription", ok: false, detail: "No Hugging Face token is set, so dictation cannot be transcribed." };
  return withTimeout(
    async (signal) => {
      const response = await fetch("https://router.huggingface.co/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        cache: "no-store"
      });
      if (response.ok) return { area: "Voice transcription", ok: true, detail: "The Hugging Face token is valid and the router answered." };
      return {
        area: "Voice transcription",
        ok: false,
        detail: response.status === 401 || response.status === 403
          ? "Hugging Face rejected the token. Recreate it with the 'Make calls to Inference Providers' permission."
          : `Hugging Face answered ${response.status}.`
      };
    },
    () => ({ area: "Voice transcription", ok: false, detail: "Hugging Face did not answer within 10 seconds." })
  );
}

/** Can the app reach its own repository — the one it commits to? */
async function checkRepository(): Promise<DiagnosticResult> {
  const token = (process.env.GITHUB_PAT ?? process.env.NAVI_GITHUB_TOKEN ?? "").trim();
  const owner = process.env.GITHUB_OWNER || "shaya99stern-hash";
  const repo = process.env.GITHUB_REPO || "navi-pwa";
  if (!token) return { area: "Own repository", ok: false, detail: `No GitHub token, so ${owner}/${repo} cannot be read or committed to.` };
  return withTimeout(
    async (signal) => {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal,
        cache: "no-store"
      });
      if (response.ok) {
        const writes = (process.env.NAVI_GITHUB_ALLOW_WRITES ?? "").trim().toLowerCase() === "true";
        return {
          area: "Own repository",
          ok: true,
          detail: `${owner}/${repo} is readable. Commits and pull requests are ${writes ? "enabled" : "OFF — set NAVI_GITHUB_ALLOW_WRITES=true to enable them"}.`
        };
      }
      return { area: "Own repository", ok: false, detail: `GitHub answered ${response.status} for ${owner}/${repo}.` };
    },
    () => ({ area: "Own repository", ok: false, detail: "GitHub did not answer within 10 seconds." })
  );
}

/** Which answering providers hold a credential. Presence only — cheap. */
function checkProviders(): DiagnosticResult {
  const names: Array<[string, string]> = [
    ["Groq", "GROQ_API_KEY"], ["Gemini", "GEMINI_API_KEY"], ["Hugging Face", "HF_TOKEN"],
    ["Cerebras", "CEREBRAS_API_KEY"], ["OpenRouter", "OPENROUTER_API_KEY"], ["Together", "TOGETHER_API_KEY"],
    ["Mistral", "MISTRAL_API_KEY"], ["DeepSeek", "DEEPSEEK_API_KEY"]
  ];
  const set = names.filter(([, key]) => (process.env[key] ?? "").trim()).map(([label]) => label);
  return set.length
    ? { area: "Answering providers", ok: true, detail: `${set.length} configured: ${set.join(", ")}. Use test_connector for a live check of any one of them.` }
    : { area: "Answering providers", ok: false, detail: "No provider credentials are set, so nothing can answer." };
}

/**
 * Whether the hardest requests can reach a frontier model.
 *
 * Worth its own row because it is the one setting that changes how good the
 * answers are, and because every failure mode is silent: with no model named
 * the app simply answers slightly less well and says nothing; with a model
 * named but no OpenRouter key it never escalates; with both but no durable
 * spend store the ledger refuses to authorise spending. Three different
 * causes, one indistinguishable symptom — a good answer where a better one
 * was available.
 */
function checkFrontier(): DiagnosticResult {
  const model = (process.env.NAVI_FRONTIER_MODEL ?? "").trim();
  const openrouter = Boolean((process.env.OPENROUTER_API_KEY ?? "").trim());
  if (!model) {
    return {
      area: "Frontier escalation",
      ok: false,
      detail: "No frontier model is set, so hard requests are answered by the free routes. Set NAVI_FRONTIER_MODEL to an OpenRouter model id to raise the ceiling on difficult work. This one costs money per request, which is why it is off by default."
    };
  }
  if (!openrouter) {
    return { area: "Frontier escalation", ok: false, detail: `NAVI_FRONTIER_MODEL is set to “${model}” but there is no OPENROUTER_API_KEY, so it can never be reached.` };
  }
  return { area: "Frontier escalation", ok: true, detail: `Hard requests escalate to “${model}” via OpenRouter, within the monthly spending limit. Everything else stays on the free routes.` };
}

/** Web search, which the user can switch on and then find does nothing. */
function checkSearch(): DiagnosticResult {
  const tavily = (process.env.TAVILY_API_KEY ?? "").trim();
  const exa = (process.env.EXA_API_KEY ?? "").trim();
  if (tavily || exa) return { area: "Web search", ok: true, detail: `Configured via ${tavily ? "Tavily" : "Exa"}.` };
  return { area: "Web search", ok: false, detail: "No search key, so the Research switch cannot actually browse." };
}

/**
 * The self-diagnosis tool.
 *
 * Deliberately one tool rather than one per area: the question people ask is
 * "what is broken", not "is Supabase reachable". Answering the broad question
 * needs every check run together so the model can say which of them failed and
 * which are fine, in one turn, instead of guessing which to look at.
 */
/**
 * Every check, run together.
 *
 * Exported so the Diagnostics screen can run exactly what the model runs.
 * Two implementations of "what is broken" would drift, and the first time they
 * disagreed nobody would know which to believe.
 */
export async function runAllChecks(clerkToken?: string): Promise<DiagnosticResult[]> {
  return Promise.all([
    checkCloudMemory(clerkToken),
    checkTranscription(),
    checkRepository(),
    Promise.resolve(checkProviders()),
    Promise.resolve(checkFrontier()),
    Promise.resolve(checkSearch())
  ]);
}

export function buildDiagnosticTools({ clerkToken, onActivity = () => {} }: {
  clerkToken?: string;
  onActivity?: (label: string) => void;
} = {}): ToolSet {
  return {
    diagnose_self: tool({
      description:
        "Check what is actually working in this deployment right now: cloud memory (whether skills and chats can really be saved), voice transcription, the app's own GitHub repository, answering providers, and web search. Each check performs a real request and reports what came back, including the exact failure. Use this whenever the user asks what is broken, why something is not working, whether a capability is available, or why you could not save, remember, commit, transcribe, or search — and before telling them a capability does not exist. Never guess at the cause of a failure when this tool can measure it.",
      inputSchema: z.object({
        area: z.enum(["all", "memory", "voice", "repository", "providers", "search"])
          .optional()
          .describe("Which area to check. Defaults to all, which is usually right.")
      }),
      execute: async ({ area = "all" }) => {
        onActivity("Checking what is working");
        const wanted = (name: string) => area === "all" || area === name;
        const results = await Promise.all([
          wanted("memory") ? checkCloudMemory(clerkToken) : null,
          wanted("voice") ? checkTranscription() : null,
          wanted("repository") ? checkRepository() : null,
          wanted("providers") ? Promise.resolve(checkProviders()) : null,
          wanted("providers") ? Promise.resolve(checkFrontier()) : null,
          wanted("search") ? Promise.resolve(checkSearch()) : null
        ].filter(Boolean) as Array<Promise<DiagnosticResult> | DiagnosticResult>);

        const failing = results.filter((entry) => !entry.ok);
        return [
          failing.length
            ? `${failing.length} of ${results.length} checks failed. Report the failing ones to the user in plain language, including what they need to do. Do not soften, and do not offer a different explanation than the one measured here.`
            : `All ${results.length} checks passed. If the user is reporting a problem anyway, it is not one of these — say so and ask what they saw, rather than inventing a cause.`,
          "",
          ...results.map((entry) => `${entry.ok ? "OK" : "FAILED"} — ${entry.area}: ${entry.detail}`)
        ].join("\n");
      }
    })
  };
}
