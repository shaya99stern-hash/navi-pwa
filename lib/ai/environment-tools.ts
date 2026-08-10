import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { PROVIDERS, PROVIDER_IDS, providerApiKey } from "./provider-registry";
import { PROVIDER_CATALOG, findProvider, isEntryConfigured } from "./provider-catalog";
import { coolingProviders } from "./provider-health";
import { hasWebSearch, searchProviderName } from "./web-tools";
import { selfUpdateRepo, selfUpdateToken } from "./self-update-tools";

/**
 * NaviSoul finding out what it can actually do, right now.
 *
 * Every fabricated answer in this app's history has the same shape: asked
 * about itself, NaviSoul reasoned from what it assumed rather than looked.
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
 */

const TIMEOUT_MS = 12_000;

export function buildEnvironmentTools({ onActivity = () => {} }: {
  onActivity?: (label: string) => void;
} = {}): ToolSet {
  return {
    inspect_environment: tool({
      description:
        "Read what NaviOS can actually do right now: which model providers are configured and which are failing, whether web research, image and sound generation, the code sandbox, self-editing, and cloud memory are available, and which services are connected. Call this before answering ANY question about your own capabilities, setup, or why something is not working — never answer those from assumption. Also call it when a feature misbehaves, to see whether it is configured at all.",
      inputSchema: z.object({}),
      execute: async () => {
        onActivity("Checking what is available");

        const configured = PROVIDER_IDS.filter((id) => Boolean(providerApiKey(PROVIDERS[id])));
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
          `Voice transcription: ${providerApiKey(PROVIDERS.huggingface) ? "available" : "unavailable — needs HF_TOKEN"}.`,
          `Self-editing: ${selfUpdateToken() ? `available on ${repo.owner}/${repo.repo}; commits deploy automatically` : "unavailable — needs GITHUB_PAT"}.`,
          "",
          "Services:",
          ...services.map(({ entry, on }) => `- ${entry.label}: ${on ? "connected" : "not set"}${on ? "" : ` (${entry.envKey})`}`),
          "",
          "State this from the list above rather than from memory. If something the user wants is 'not set', name the variable and where a key comes from instead of saying the feature is broken."
        ];
        return lines.join("\n");
      }
    }),

    test_service: tool({
      description:
        "Actually call a connected service to find out whether its key works — expired, revoked, and under-permissioned keys look identical to working ones until something is tried. Use this when a feature fails and you want to know whether the credential is the cause, rather than speculating.",
      inputSchema: z.object({
        service: z.string().describe("The service name, e.g. 'Hugging Face', 'Groq', 'Tavily', 'GitHub'.")
      }),
      execute: async ({ service }) => {
        const entry = findProvider(service);
        if (!entry) return `NaviOS does not know a service called "${service}".`;
        if (!isEntryConfigured(entry)) return `${entry.label} has no key set. It needs ${entry.envKey}; a key comes from ${entry.keyUrl}.`;

        const adapter = PROVIDER_IDS.find((id) => id === entry.id);
        if (!adapter) return `${entry.label} is configured. It has no simple endpoint to test from here, so treat it as set but unverified.`;

        onActivity(`Testing ${entry.label}`);
        const key = providerApiKey(PROVIDERS[adapter]);
        if (!key) return `${entry.label} looked configured but no usable key resolved.`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const url = adapter === "gemini"
            ? `${PROVIDERS.gemini.modelsUrl}?key=${encodeURIComponent(key)}`
            : PROVIDERS[adapter].modelsUrl;
          const headers: Record<string, string> = adapter === "gemini" ? {} : { Authorization: `Bearer ${key}` };
          const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });

          if (response.status === 401 || response.status === 403) {
            return `${entry.label} rejected its key. It is expired, revoked, or lacks the needed permission. A new key: ${entry.keyUrl}`;
          }
          if (response.status === 429) return `${entry.label} is working but rate limited right now.`;
          if (!response.ok) return `${entry.label} answered ${response.status}.`;
          return `${entry.label} answered normally. The key works.`;
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          return `${entry.label} ${aborted ? "timed out" : "could not be reached"}.`;
        } finally {
          clearTimeout(timer);
        }
      }
    })
  };
}
