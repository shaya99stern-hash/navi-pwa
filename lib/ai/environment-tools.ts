import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { PROVIDERS, PROVIDER_IDS, providerApiKey } from "./provider-registry";
import { PROVIDER_CATALOG, findProvider, isEntryConfigured } from "./provider-catalog";
import { coolingProviders } from "./provider-health";
import { hasWebSearch, searchProviderName } from "./web-tools";
import { selfUpdateRepo, selfUpdateToken } from "./self-update-tools";
import { describeProbe, planProbe, runProbe } from "./service-probe";
import { transcriptionCandidates } from "./voice/transcription-models";
import { readTtsUsage, ttsConfigured } from "./voice/tts";

/**
 * Navi Soul finding out what it can actually do, right now.
 *
 * Every fabricated answer in this app's history has the same shape: asked
 * about itself, Navi Soul reasoned from what it assumed rather than looked.
 * It invented a Settings path, invented a SHOW_DEVELOPER flag, announced it
 * had no code sandbox when one was built in but unconfigured, and insisted it
 * could not reach the repository while holding repository tools.
 *
 * None of that was a reasoning failure. The information existed — in the
 * environment, in the provider registry, in the health tracker — and nothing
 * let the model read it. These tools do.
 *
 * Everything returned is a fact about configuration, never a credential.
 * Presence, health, and identity only.
 *
 * ## The word this file got wrong for a long time
 *
 * It reported each service as `connected` or `not set`, from `isEntryConfigured`
 * — which asks whether an environment variable is a non-empty string. That is a
 * fine answer to *is a key present*. It is not an answer to *is this connected*,
 * and the gap between those two is every expired token, every revoked one, every
 * key for the wrong account, and every placeholder pasted during setup.
 *
 * The owner reported it from the outside: *"it says also it's connected to
 * GitHub. I don't think it really is."* The prompt tells the model to answer
 * capability questions from this tool and never from memory — so this tool
 * saying "connected" is the whole of what the model knows, and it was reporting
 * a string length as a working integration.
 *
 * Three states are kept apart here now, because collapsing them is what caused
 * the false report: **not set** (no credential), **set but unverified** (a
 * credential exists and nothing has called anything with it), and **verified**
 * (`test_service` used it against the real API this turn). The middle state is
 * the common one and it is not a failure — it is simply not the claim the word
 * "connected" makes.
 *
 * ## Two different GitHubs, which is its own source of confusion
 *
 * A deployment-wide token in the environment powers self-editing. A per-person
 * OAuth account, connected from the phone, powers the repository read tools.
 * Either can be present without the other, they answer to different questions,
 * and reporting only the first — which is all this tool used to see — makes
 * "am I connected to GitHub?" unanswerable. Google is per-person only, and was
 * not reported at all: it has no catalogue row, so a question about Gmail or
 * Calendar had nothing to read and got an invented answer.
 */

const TIMEOUT_MS = 12_000;

/**
 * Per-person connections, resolved for this request by the caller.
 *
 * Passed in rather than read here because both live in cookies, which are
 * request-scoped: `cookies()` throws once the request closes, and these tools
 * run inside a stream callback that outlives it.
 *
 * `undefined` is deliberately distinct from `false`. A field nobody supplied
 * means the wiring did not reach this tool, and reporting that as "not
 * connected" would turn a plumbing regression into a confident wrong answer —
 * which is the exact failure mode this whole file exists to close.
 */
export type AccountConnections = {
  /** Whether a per-person GitHub OAuth token resolved for this request. */
  github?: boolean;
  /** Whether this deployment has a GitHub OAuth app at all. */
  githubOAuthAvailable?: boolean;
  /** Whether a Google access token resolved for this request. */
  google?: boolean;
  /** Whether this deployment has a Google OAuth app at all. */
  googleOAuthAvailable?: boolean;
};

/** One line per account, keeping "you did not connect it" apart from "it cannot be connected". */
function describeAccount(options: {
  label: string;
  what: string;
  connected: boolean | undefined;
  available: boolean | undefined;
  variables: string;
}): string {
  const { label, what, connected, available, variables } = options;
  if (connected === undefined || available === undefined) {
    return `- ${label}: not reported for this request. That is a wiring fault in the app, not a disconnected account — say exactly that rather than guessing either way.`;
  }
  if (!available) {
    return `- ${label}: cannot be connected on this deployment — it has no OAuth app configured (${variables}). ${what}`;
  }
  if (!connected) {
    return `- ${label}: not connected. The deployment supports it; nobody has signed in to it from this device yet. Connecting is on the Connectors screen. ${what}`;
  }
  return `- ${label}: connected, and the token was accepted when this request was built. ${what}`;
}

export function buildEnvironmentTools({ onActivity = () => {}, connections = {}, githubToken }: {
  onActivity?: (label: string) => void;
  connections?: AccountConnections;
  /**
   * The signed-in person's GitHub OAuth token, so `test_service` checks the
   * credential the repository tools actually send. Never rendered — only the
   * account name it resolves to is, and a login is a public name where a token
   * is not.
   */
  githubToken?: string;
} = {}): ToolSet {
  return {
    inspect_environment: tool({
      description:
        "Read what NaviOS can actually do right now: which model providers are configured and which are failing, whether web research, image and sound generation, the code sandbox, self-editing, and cloud memory are available, which accounts are connected, and which service keys are present. Call this before answering ANY question about your own capabilities, setup, or why something is not working — never answer those from assumption. It reports whether a key is *present*; use test_service when the question is whether that key still *works*.",
      inputSchema: z.object({}),
      execute: async () => {
        onActivity("Checking what is available");

        const configured = PROVIDER_IDS.filter((id) => Boolean(providerApiKey(PROVIDERS[id])));
        const transcription = transcriptionCandidates();
        const voice = await readTtsUsage();
        const cooling = coolingProviders();
        const repo = selfUpdateRepo();
        const services = PROVIDER_CATALOG.map((entry) => ({ entry, on: isEntryConfigured(entry) }));

        const lines = [
          "## What is available right now",
          "",
          `Model providers configured: ${configured.length ? configured.map((id) => PROVIDERS[id].label).join(", ") : "none"}.`,
          /* Health matters more than presence: a configured provider that is
             failing is why an answer felt slow, and saying so beats guessing. */
          cooling.length
            ? `Currently failing and deprioritised: ${cooling.map((id) => PROVIDERS[id].label).join(", ")}. Requests are routing around them.`
            : "All configured providers are healthy.",
          "",
          `Web research: ${hasWebSearch() ? `available through ${searchProviderName()}` : "unavailable — needs TAVILY_API_KEY or EXA_API_KEY"}.`,
          `Image and sound generation: ${providerApiKey(PROVIDERS.huggingface) ? "available" : "unavailable — needs HF_TOKEN"}.`,
          /* Read off the same ladder the transcriber actually walks. This said
             "needs HF_TOKEN" long after Groq became the preferred path, so the
             answer named a variable that was neither required nor first. */
          `Voice transcription: ${transcription.length
            ? `available through ${transcription.map((candidate) => candidate.label).join(", then ")}`
            : "unavailable — needs GROQ_API_KEY or HF_TOKEN"}.`,
          /* The premium speaking voice, which nothing could look up until now.
             Asked why it sounded like the device voice, the honest answer
             required reading a credential and a ledger that no tool exposed —
             so the answer was a guess, every time, for as long as the feature
             has existed. */
          `Premium speaking voice: ${ttsConfigured()
            ? `configured; ${voice.remaining} of ${voice.budget} characters left this month${voice.durable ? "" : " (the ledger is in memory only, so this resets when the deployment restarts)"}`
            : "not configured — needs ELEVENLABS_API_KEY. The device's own voice is used instead, which is a working configuration and not a fault"}.`,
          /* This said commits "deploy automatically". That was true until
             self-edits were moved onto a branch behind a pull request, and then
             it was a false promise from the one tool the prompt calls the
             authority — the owner would go looking in the running app for a
             change that is waiting in CI. The prose in `app-knowledge.ts` was
             corrected at the time and this line was missed, which is the case
             for deriving both from one place rather than writing the sentence
             twice. */
          `Self-editing: ${selfUpdateToken()
            ? `available on ${repo.owner}/${repo.repo}. Edits land on a branch and open a pull request; they are NOT live until it is merged`
            : "unavailable — needs GITHUB_PAT"}.`,
          "",
          /* The half of "what are you connected to" that lives in a cookie
             rather than in the environment, and that nothing here could see
             until now. Google appears only in this section: it has no catalogue
             row, because there is no Google *key* — there is only a person who
             did or did not sign in. */
          "Accounts connected from this device:",
          describeAccount({
            label: "GitHub account",
            what: "This is what powers reading repositories, files, commits and CI. It is separate from the deployment's own GitHub token below, which powers self-editing — either can exist without the other, so never infer one from the other.",
            connected: connections.github,
            available: connections.githubOAuthAvailable,
            variables: "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET"
          }),
          describeAccount({
            label: "Google (Gmail and Calendar)",
            what: "There is no Google API key anywhere in this app; a Google connection is only ever a signed-in account, so it will never appear in the key list below.",
            connected: connections.google,
            available: connections.googleOAuthAvailable,
            variables: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"
          }),
          "",
          /* Presence, named as presence. The previous wording — "connected" —
             was a claim about a working integration made on the evidence of a
             non-empty string, and it is the reason the owner was told this app
             had GitHub access it did not have. */
          "Service keys (whether a key is present — not whether it still works):",
          ...services.map(({ entry, on }) => `- ${entry.label}: ${on ? "key set, unverified" : `not set (${entry.envKey})`}`),
          "",
          "State this from the list above rather than from memory. Two rules about the key list: 'key set' means a value exists, not that it works — if the question is whether a service is genuinely reachable, call `test_service` and answer from what it returns. And if something is 'not set', name the variable and where a key comes from instead of saying the feature is broken."
        ];
        return lines.join("\n");
      }
    }),

    test_service: tool({
      description:
        "Actually call a service to find out whether its key works — expired, revoked, under-permissioned, and wrong-account keys look identical to working ones until something is tried. Use this whenever the answer depends on a service really being reachable, and whenever a feature fails and you want to know if the credential is the cause. For GitHub and Vercel it also reports which account the key belongs to.",
      inputSchema: z.object({
        service: z.string().describe("The service name, e.g. 'Hugging Face', 'Groq', 'Tavily', 'GitHub', 'Vercel', 'Supabase'.")
      }),
      execute: async ({ service }) => {
        const entry = findProvider(service);
        if (!entry) return `NaviOS does not know a service called "${service}".`;
        if (!isEntryConfigured(entry)) return `${entry.label} has no key set. It needs ${entry.envKey}; a key comes from ${entry.keyUrl}.`;

        /* Planned before announcing, so a service that cannot be probed says so
           immediately instead of showing the user a check that never happened.
           This used to resolve a *model adapter* and give up on anything that
           was not one — which was every service in the catalogue that is not a
           model, including the two the owner was actually asking about. */
        const plan = planProbe(entry, { githubToken });
        if (plan.kind === "none") return describeProbe(entry, { kind: "unprobeable", why: plan.why });

        onActivity(`Testing ${entry.label}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          return describeProbe(entry, await runProbe(plan, controller.signal), plan.subject);
        } finally {
          clearTimeout(timer);
        }
      }
    })
  };
}
