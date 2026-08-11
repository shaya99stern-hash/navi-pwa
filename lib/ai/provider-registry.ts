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
  /**
   * The largest single request this provider will actually accept, when that
   * is smaller than the context window.
   *
   * These are different limits and the app conflated them, which is what took
   * production down. Groq's free `on_demand` tier rations by *throughput* — 8,000
   * tokens per minute on `openai/gpt-oss-120b` — and counts a single request's
   * input plus its reserved `max_tokens` against that window. So the model
   * advertises a 131,072-token context and refuses anything past 8,000:
   *
   *   AI_APICallError: Request too large ... service tier `on_demand`
   *   on tokens per minute (TPM): Limit 8000, Requested 20805
   *
   * Sizing requests against `contextWindow` therefore built a request no route
   * could take, and no amount of retrying or failing over could fix it — the
   * request was structurally impossible before it was sent.
   *
   * Set only where there is evidence. Groq's 8,000 is quoted from a real
   * refusal in the runtime logs. Every other provider is left undefined and
   * falls back to its context window, because a limit invented from memory
   * would re-create the original bug with a different number. An operator whose
   * account has a different allowance sets `NAVI_<PROVIDER>_TOKEN_LIMIT`
   * without waiting for a deploy; see `requestTokenCeiling`.
   */
  requestTokenLimit?: number;
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
    /* Quoted from the refusal, not estimated. The free tier's per-minute
       allowance is the binding constraint here, never the context window. */
    requestTokenLimit: 8_000,
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
  /**
   * The quality lane, and the only row here that costs money.
   *
   * `costPerMTok` is the cache-miss input rate for the default model, recorded
   * so nothing has to infer "this one is metered" from the provider's name.
   * The authority on spend is `spend.ts`, which prices from each response's own
   * usage object rather than from this number.
   */
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    modelsUrl: "https://api.deepseek.com/v1/models",
    envKeys: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY", "DEEPSEEK_API_TOKEN"],
    envHint: "DEEPSEEK",
    keyPrefixes: [],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 1_000_000,
    costPerMTok: 0.14
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
  },
  /* Three more free tiers. Every one speaks the OpenAI protocol, so each is a
     row here and a key in Vercel rather than an integration — which is the
     whole reason the registry has this shape. A council is only as good as
     the spread of independent models in it, and these widen that spread
     without widening the bill. */
  together: {
    id: "together",
    label: "Together",
    baseURL: "https://api.together.xyz/v1",
    modelsUrl: "https://api.together.xyz/v1/models",
    envKeys: ["TOGETHER_API_KEY", "TOGETHER_KEY", "TOGETHER_API_TOKEN"],
    envHint: "TOGETHER",
    keyPrefixes: [],
    supportsTools: true,
    supportsVision: true,
    contextWindow: 131_072,
    costPerMTok: 0
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    baseURL: "https://integrate.api.nvidia.com/v1",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NIM_API_KEY"],
    envHint: "NVIDIA",
    keyPrefixes: ["nvapi-"],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 131_072,
    costPerMTok: 0
  },
  sambanova: {
    id: "sambanova",
    label: "SambaNova",
    baseURL: "https://api.sambanova.ai/v1",
    modelsUrl: "https://api.sambanova.ai/v1/models",
    envKeys: ["SAMBANOVA_API_KEY", "SAMBANOVA_KEY"],
    envHint: "SAMBANOVA",
    keyPrefixes: [],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 131_072,
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

/**
 * The largest request this provider will take, input plus reserved output.
 *
 * Three sources, narrowest wins: an operator's override, the measured
 * `requestTokenLimit`, and the context window. The override exists because free
 * tiers are per-account and change without notice — the deployment that hits a
 * different allowance should be able to say so in an environment variable
 * rather than wait for someone to edit this file. It can only narrow: a number
 * larger than the model's context window is not a permission, it is a request
 * that gets truncated.
 *
 * A ceiling, not a target. Callers subtract what they intend to reserve for the
 * reply and treat what remains as the input budget.
 */
export function requestTokenCeiling(adapter: ProviderAdapter): number {
  const override = Number.parseInt((process.env[`NAVI_${adapter.id.toUpperCase()}_TOKEN_LIMIT`] ?? "").trim(), 10);
  const configured = Number.isFinite(override) && override > 0 ? override : adapter.requestTokenLimit;
  return Math.min(configured ?? adapter.contextWindow, adapter.contextWindow);
}
