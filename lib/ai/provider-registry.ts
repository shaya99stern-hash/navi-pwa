import type { ProviderName } from "./types";

/**
 * Every provider, as one row of config.
 *
 * Before this, adding or retiring a provider meant editing a key lookup, an
 * availability object, a probe list, a six-branch model factory, and a
 * tool-capability array — five places, each of which could be updated without
 * the others and none of which would complain. GitHub Models was retired
 * upstream and removing it touched all five. A retirement should be one line.
 *
 * The rule this encodes: providers are config, not code paths. Nothing outside
 * this file should branch on a provider name.
 */
export type ProviderAdapter = {
  id: ProviderName;
  /** Internal only. Never rendered — no user-visible surface names a provider. */
  label: string;
  /** OpenAI-compatible base URL. Every provider here speaks that protocol. */
  baseURL: string;
  /** Listing models: the cheapest call that proves the key works. */
  modelsUrl: string;
  /** Environment variable names this key has been called, in priority order. */
  envKeys: string[];
  /**
   * Substring that identifies this provider in an environment variable name,
   * for accounts that named the variable something we never anticipated.
   */
  envHint: string;
  /** Distinctive key prefixes, the last resort when the name gives nothing. */
  keyPrefixes: string[];
  /** Overrides `envHint` where the provider's naming is genuinely irregular. */
  keyMatches?: (normalizedKey: string) => boolean;
  /**
   * Whether models on this provider accept a `tools` array.
   *
   * A provider-wide answer is the *ceiling*, not the verdict: individual models
   * still opt out through `TOOL_INCAPABLE_MODELS`. Tool support is ultimately a
   * property of the model, and treating it as a provider fact is what sent a
   * tools array to an agentic system that rejects one and failed every
   * tool-enabled request.
   */
  supportsTools: boolean;
  supportsVision: boolean;
  /** Tokens, for the smallest context window this provider's routes rely on. */
  contextWindow: number;
  /** USD per million input tokens. Zero means a free tier. */
  costPerMTok: number;
  /** Headers beyond authorization. Attribution needs the request origin. */
  headers?: (origin: string) => Record<string, string>;
};

/** Attribution headers, which the free tiers use to identify the caller. */
const attribution = (origin: string) => ({ "HTTP-Referer": origin, "X-Title": "NaviOS" });

export const PROVIDERS: Record<ProviderName, ProviderAdapter> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    envKeys: ["GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"],
    envHint: "GEMINI",
    keyPrefixes: ["AIza"],
    supportsTools: true,
    supportsVision: true,
    contextWindow: 1_000_000,
    costPerMTok: 0
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    envKeys: ["GROQ_API_KEY", "GROQ_API", "GROQ_KEY", "GROQ_TOKEN", "GROQ_API_TOKEN", "GROQ_SECRET_KEY"],
    envHint: "GROQ",
    keyPrefixes: ["gsk_"],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 131_072,
    costPerMTok: 0
  },
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    baseURL: "https://router.huggingface.co/v1",
    modelsUrl: "https://router.huggingface.co/v1/models",
    envKeys: [
      "HF_TOKEN",
      "HUGGING_FACE_FINE_GRAINED_API",
      "fable_read_Hugging_face",
      "HUGGING_FACE_API_Write",
      "HF_API_TOKEN",
      "HF_API_KEY",
      "HF_ACCESS_TOKEN",
      "HUGGINGFACE_API_KEY",
      "HUGGING_FACE_API_KEY",
      "HUGGINGFACE_TOKEN",
      "HUGGING_FACE_TOKEN",
      "HUGGINGFACE_HUB_TOKEN",
      "HUGGING_FACE_HUB_TOKEN",
      "HUGGINGFACE_ACCESS_TOKEN",
      "HUGGING_FACE_ACCESS_TOKEN"
    ],
    envHint: "HUGGINGFACE",
    keyPrefixes: ["hf_"],
    /* "HF" as a bare prefix is too short to fold into the generic hint without
       matching unrelated variables, so this provider keeps its own predicate. */
    keyMatches: (key) => {
      const secretish = key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET");
      return secretish && (key.includes("HUGGINGFACE") || key.startsWith("HF"));
    },
    /* The router fronts many open models, plenty of which reject a tools
       parameter outright. Sending one would break routes that work today, so
       this is the one provider deliberately marked as tool-free. */
    supportsTools: false,
    supportsVision: true,
    contextWindow: 32_768,
    costPerMTok: 0
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    modelsUrl: "https://api.cerebras.ai/v1/models",
    envKeys: ["CEREBRAS_API_KEY", "CEREBRAS_KEY", "CEREBRAS_API_TOKEN"],
    envHint: "CEREBRAS",
    keyPrefixes: ["csk-"],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 65_536,
    costPerMTok: 0
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    envKeys: ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY", "OPENROUTER_KEY", "OPENROUTER_TOKEN"],
    envHint: "OPENROUTER",
    keyPrefixes: ["sk-or-"],
    supportsTools: true,
    supportsVision: true,
    contextWindow: 131_072,
    // Free-tier only: routes carry the `:free` suffix, and discovery enforces it.
    costPerMTok: 0,
    headers: attribution
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    modelsUrl: "https://api.mistral.ai/v1/models",
    envKeys: ["MISTRAL_API_KEY", "MISTRAL_KEY", "MISTRAL_API_TOKEN"],
    envHint: "MISTRAL",
    keyPrefixes: [],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 128_000,
    costPerMTok: 0
  }
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderName[];

function usableSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  if (!secret || /^(?:undefined|null|none|changeme|your[_ -]?key)$/i.test(secret)) return undefined;
  return secret;
}

function normalizedEnvironmentKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Find a provider's credential.
 *
 * Three passes, widening as they go: the names we know, then any variable whose
 * name identifies the provider and looks like a secret, then any value with a
 * recognisable key prefix. The later passes exist because keys get pasted into
 * variables named whatever the person was thinking at the time, and an app that
 * only reads the canonical name reports "not configured" while the key sits
 * right there in the environment.
 */
export function providerApiKey(adapter: ProviderAdapter): string | undefined {
  for (const name of adapter.envKeys) {
    const secret = usableSecret(process.env[name]);
    if (secret) return secret;
  }

  const matches = adapter.keyMatches
    ?? ((key: string) => key.includes(adapter.envHint) && (key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET")));

  for (const [key, rawValue] of Object.entries(process.env)) {
    const value = usableSecret(rawValue);
    if (value && matches(normalizedEnvironmentKey(key))) return value;
  }

  if (!adapter.keyPrefixes.length) return undefined;
  for (const rawValue of Object.values(process.env)) {
    const value = usableSecret(rawValue);
    if (value && adapter.keyPrefixes.some((prefix) => value.startsWith(prefix))) return value;
  }

  return undefined;
}

export function providerHeaders(adapter: ProviderAdapter, origin: string): Record<string, string> | undefined {
  return adapter.headers?.(origin);
}
