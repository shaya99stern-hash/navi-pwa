/**
 * Every service NaviOS knows how to connect itself to.
 *
 * The connector sheet offered four generic shapes and asked the user to supply
 * a base URL, which is backwards: naming a provider should be enough. "Add
 * Groq" is a complete instruction — the base URL, the environment variable,
 * and where to get a key are facts about Groq, not decisions for the person
 * holding the phone.
 *
 * This is that knowledge, in one table. It is used three ways: the connector
 * sheet lists it, a fuzzy lookup resolves a spoken or typed name onto it, and
 * NaviSoul reads it so "connect me to Together" can be carried out rather than
 * explained.
 */

export type CatalogEntry = {
  id: string;
  /** What a person calls it. First name is canonical. */
  names: string[];
  label: string;
  /** The environment variable this deployment reads the key from. */
  envKey: string;
  /** Where the key goes if it is not a model provider. */
  kind: "model" | "search" | "database" | "custom";
  /** OpenAI-compatible base URL, when there is one. */
  baseUrl?: string;
  /** Where a person gets a key, so the app never says "add a key" and stop. */
  keyUrl: string;
  /** Whether the free tier needs no card. Stated because it is the whole premise. */
  free: boolean;
  detail: string;
};

export const PROVIDER_CATALOG: CatalogEntry[] = [
  {
    id: "groq", names: ["groq"], label: "Groq", envKey: "GROQ_API_KEY", kind: "model",
    baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys",
    free: true, detail: "Very fast open models. One of the three that carry the app."
  },
  {
    id: "gemini", names: ["gemini", "google ai", "google gemini"], label: "Gemini", envKey: "GEMINI_API_KEY", kind: "model",
    keyUrl: "https://aistudio.google.com/apikey",
    free: true, detail: "Long context and vision. One of the three that carry the app."
  },
  {
    id: "huggingface", names: ["hugging face", "huggingface", "hf"], label: "Hugging Face", envKey: "HF_TOKEN", kind: "model",
    keyUrl: "https://huggingface.co/settings/tokens",
    free: true, detail: "The model council, image and sound generation, and voice transcription."
  },
  {
    id: "cerebras", names: ["cerebras"], label: "Cerebras", envKey: "CEREBRAS_API_KEY", kind: "model",
    baseUrl: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai/",
    free: true, detail: "Large open weights at unusual speed."
  },
  {
    id: "openrouter", names: ["openrouter", "open router"], label: "OpenRouter", envKey: "OPENROUTER_API_KEY", kind: "model",
    baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys",
    free: true, detail: "One key, many models. Free models carry a :free suffix."
  },
  {
    id: "together", names: ["together", "together ai"], label: "Together", envKey: "TOGETHER_API_KEY", kind: "model",
    baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.xyz/settings/api-keys",
    free: true, detail: "Open models with a free tier."
  },
  {
    id: "nvidia", names: ["nvidia", "nim", "nvidia nim"], label: "NVIDIA NIM", envKey: "NVIDIA_API_KEY", kind: "model",
    baseUrl: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com/",
    free: true, detail: "Hosted open models, free credits."
  },
  {
    id: "sambanova", names: ["sambanova", "samba nova"], label: "SambaNova", envKey: "SAMBANOVA_API_KEY", kind: "model",
    baseUrl: "https://api.sambanova.ai/v1", keyUrl: "https://cloud.sambanova.ai/apis",
    free: true, detail: "Fast Llama models on a free tier."
  },
  {
    id: "mistral", names: ["mistral"], label: "Mistral", envKey: "MISTRAL_API_KEY", kind: "model",
    baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys/",
    free: true, detail: "Mistral's own hosted models."
  },
  {
    id: "deepseek", names: ["deepseek", "deep seek"], label: "DeepSeek", envKey: "DEEPSEEK_API_KEY", kind: "model",
    baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys",
    free: false, detail: "The one metered lane. Cheap, but it does cost money."
  },
  {
    id: "openai", names: ["openai", "open ai", "gpt", "chatgpt"], label: "OpenAI", envKey: "OPENAI_API_KEY", kind: "model",
    baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys",
    free: false, detail: "Paid. Added as a custom connector rather than a lane."
  },
  {
    id: "anthropic", names: ["anthropic", "claude"], label: "Anthropic", envKey: "ANTHROPIC_API_KEY", kind: "model",
    baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys",
    free: false, detail: "Paid. Added as a custom connector rather than a lane."
  },
  {
    id: "xai", names: ["xai", "x ai", "grok"], label: "xAI", envKey: "XAI_API_KEY", kind: "model",
    baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai/",
    free: false, detail: "Grok models, OpenAI-compatible."
  },
  {
    id: "fireworks", names: ["fireworks", "fireworks ai"], label: "Fireworks", envKey: "FIREWORKS_API_KEY", kind: "model",
    baseUrl: "https://api.fireworks.ai/inference/v1", keyUrl: "https://fireworks.ai/api-keys",
    free: true, detail: "Open models with free credits."
  },
  {
    id: "cohere", names: ["cohere"], label: "Cohere", envKey: "COHERE_API_KEY", kind: "model",
    baseUrl: "https://api.cohere.ai/compatibility/v1", keyUrl: "https://dashboard.cohere.com/api-keys",
    free: true, detail: "Free trial keys, good at retrieval and rerank."
  },
  {
    id: "tavily", names: ["tavily"], label: "Tavily", envKey: "TAVILY_API_KEY", kind: "search",
    keyUrl: "https://app.tavily.com/home",
    free: true, detail: "Web research. 1,000 free searches a month."
  },
  {
    id: "exa", names: ["exa"], label: "Exa", envKey: "EXA_API_KEY", kind: "search",
    keyUrl: "https://dashboard.exa.ai/api-keys",
    free: true, detail: "Web research, an alternative to Tavily."
  },
  {
    id: "supabase-url", names: ["supabase url", "supabase project"], label: "Supabase project URL", envKey: "NEXT_PUBLIC_SUPABASE_URL", kind: "database",
    keyUrl: "https://supabase.com/dashboard/project/_/settings/api",
    free: true, detail: "Where your memory lives. Project Settings → API → Project URL."
  },
  {
    id: "supabase-key", names: ["supabase", "supabase key", "supabase anon"], label: "Supabase anon key", envKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY", kind: "database",
    keyUrl: "https://supabase.com/dashboard/project/_/settings/api",
    free: true, detail: "Your memory's key. Row-level security scopes it to your account."
  },
  {
    id: "github-pat", names: ["github", "git hub", "github token", "github pat"], label: "GitHub token", envKey: "GITHUB_PAT", kind: "custom",
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    free: true, detail: "Lets NaviSoul read and commit its own source. Contents: read and write."
  },
  {
    id: "github-writes", names: ["github writes", "allow writes"], label: "GitHub writes", envKey: "NAVI_GITHUB_ALLOW_WRITES", kind: "custom",
    keyUrl: "https://vercel.com/docs/environment-variables",
    free: true, detail: 'Set the value to "true" to let NaviSoul commit through your connected account.'
  },
  {
    id: "vercel", names: ["vercel", "vercel token"], label: "Vercel token", envKey: "NAVI_VERCEL_TOKEN", kind: "custom",
    keyUrl: "https://vercel.com/account/settings/tokens",
    free: true, detail: "Deploy reads, the code sandbox, and letting NaviOS configure itself."
  }
];

/** Normalise for matching: lowercase, letters and digits only. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve a spoken or typed name onto a catalog entry.
 *
 * Deliberately forgiving: this receives dictated text, so "open router",
 * "openrouter" and "OpenRouter's" must all land on the same row. Exact and
 * prefix matches beat substring ones so "gpt" does not win over "openai" when
 * both could apply.
 */
export function findProvider(query: string): CatalogEntry | null {
  const needle = normalize(query);
  if (!needle) return null;

  for (const entry of PROVIDER_CATALOG) {
    if (entry.names.some((name) => normalize(name) === needle) || normalize(entry.id) === needle) return entry;
  }
  for (const entry of PROVIDER_CATALOG) {
    if (entry.names.some((name) => needle.startsWith(normalize(name)) || normalize(name).startsWith(needle))) return entry;
  }
  for (const entry of PROVIDER_CATALOG) {
    if (entry.names.some((name) => needle.includes(normalize(name)) || normalize(name).includes(needle))) return entry;
  }
  return null;
}

/** Every environment variable the catalog can set, for validation. */
export function catalogEnvKeys(): Set<string> {
  return new Set(PROVIDER_CATALOG.map((entry) => entry.envKey));
}
