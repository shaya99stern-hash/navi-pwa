import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelPreset, ProviderName, ProviderRoute, ToolCallingSupport, ToolPolicy } from "./types";

export type ProviderAvailability = Record<ProviderName, boolean>;

function usableSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  if (!secret || /^(?:undefined|null|none|changeme|your[_ -]?key)$/i.test(secret)) return undefined;
  return secret;
}

function firstSecret(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const secret = usableSecret(value);
    if (secret) return secret;
  }
  return undefined;
}

function normalizedEnvironmentKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function environmentSecret(options: {
  keyMatches: (normalizedKey: string) => boolean;
  valuePrefixes: string[];
}): string | undefined {
  for (const [key, rawValue] of Object.entries(process.env)) {
    const value = usableSecret(rawValue);
    if (!value) continue;
    if (options.keyMatches(normalizedEnvironmentKey(key))) return value;
  }

  for (const rawValue of Object.values(process.env)) {
    const value = usableSecret(rawValue);
    if (value && options.valuePrefixes.some((prefix) => value.startsWith(prefix))) return value;
  }

  return undefined;
}

function geminiApiKey(): string | undefined {
  return firstSecret([
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_KEY,
    process.env.GOOGLE_GEMINI_API_KEY,
    process.env.GOOGLE_AI_API_KEY,
    process.env.GOOGLE_API_KEY
  ]) ?? environmentSecret({
    keyMatches: (key) => key.includes("GEMINI") && (key.includes("KEY") || key.includes("TOKEN")),
    valuePrefixes: ["AIza"]
  });
}

function groqApiKey(): string | undefined {
  return firstSecret([
    process.env.GROQ_API_KEY,
    process.env.GROQ_API,
    process.env.GROQ_KEY,
    process.env.GROQ_TOKEN,
    process.env.GROQ_API_TOKEN,
    process.env.GROQ_SECRET_KEY
  ]) ?? environmentSecret({
    keyMatches: (key) => key.includes("GROQ") && (key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET")),
    valuePrefixes: ["gsk_"]
  });
}

function huggingFaceToken(): string | undefined {
  return firstSecret([
    process.env.HF_TOKEN,
    process.env.HUGGING_FACE_FINE_GRAINED_API,
    process.env.fable_read_Hugging_face,
    process.env.HUGGING_FACE_API_Write,
    process.env.HF_API_TOKEN,
    process.env.HF_API_KEY,
    process.env.HF_ACCESS_TOKEN,
    process.env.HUGGINGFACE_API_KEY,
    process.env.HUGGING_FACE_API_KEY,
    process.env.HUGGINGFACE_TOKEN,
    process.env.HUGGING_FACE_TOKEN,
    process.env.HUGGINGFACE_HUB_TOKEN,
    process.env.HUGGING_FACE_HUB_TOKEN,
    process.env.HUGGINGFACE_ACCESS_TOKEN,
    process.env.HUGGING_FACE_ACCESS_TOKEN
  ]) ?? environmentSecret({
    keyMatches: (key) => {
      const namedHuggingFace = key.includes("HUGGINGFACE") && (key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET"));
      const namedHf = key.startsWith("HF") && (key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET"));
      return namedHuggingFace || namedHf;
    },
    valuePrefixes: ["hf_"]
  });
}

export function getHuggingFaceToken(): string | undefined {
  return huggingFaceToken();
}

/* Three optional free tiers. Each is additive: absent, nothing changes;
   present, it joins the routing pool without any further configuration. */

function cerebrasApiKey(): string | undefined {
  return firstSecret([
    process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_KEY,
    process.env.CEREBRAS_API_TOKEN
  ]) ?? environmentSecret({
    keyMatches: (key) => key.includes("CEREBRAS") && (key.includes("KEY") || key.includes("TOKEN")),
    valuePrefixes: ["csk-"]
  });
}

function openRouterApiKey(): string | undefined {
  return firstSecret([
    process.env.OPENROUTER_API_KEY,
    process.env.OPEN_ROUTER_API_KEY,
    process.env.OPENROUTER_KEY,
    process.env.OPENROUTER_TOKEN
  ]) ?? environmentSecret({
    keyMatches: (key) => key.includes("OPENROUTER") && (key.includes("KEY") || key.includes("TOKEN")),
    valuePrefixes: ["sk-or-"]
  });
}

function mistralApiKey(): string | undefined {
  return firstSecret([
    process.env.MISTRAL_API_KEY,
    process.env.MISTRAL_KEY,
    process.env.MISTRAL_API_TOKEN
  ]) ?? environmentSecret({
    keyMatches: (key) => key.includes("MISTRAL") && (key.includes("KEY") || key.includes("TOKEN")),
    valuePrefixes: []
  });
}

export function getProviderAvailability(): ProviderAvailability {
  return {
    gemini: Boolean(geminiApiKey()),
    groq: Boolean(groqApiKey()),
    huggingface: Boolean(huggingFaceToken()),
    cerebras: Boolean(cerebrasApiKey()),
    openrouter: Boolean(openRouterApiKey()),
    mistral: Boolean(mistralApiKey())
  };
}

/**
 * The original three carry the app on their own; the rest are upgrades.
 * "Full stack" therefore still means the three the app needs, so an account
 * without the optional tiers is not reported as incomplete.
 */
const CORE_PROVIDERS: ProviderName[] = ["gemini", "groq", "huggingface"];

export function getProviderStackStatus() {
  const providers = getProviderAvailability();
  const core = CORE_PROVIDERS.filter((provider) => providers[provider]);
  const active = Object.values(providers).filter(Boolean).length;
  return {
    providers,
    active,
    total: CORE_PROVIDERS.length,
    fullStack: core.length === CORE_PROVIDERS.length,
    missing: CORE_PROVIDERS.filter((provider) => !providers[provider])
  };
}

/**
 * A minimal authenticated request per provider, for diagnosing credentials.
 *
 * Every provider refusing at once is a different problem from one refusing,
 * and the chat route cannot tell them apart — it reports whatever the last
 * attempt said. Listing models is the cheapest call that still proves the key
 * works and the host is reachable, and it costs no tokens.
 *
 * The key never leaves this module: the caller receives a prepared request, so
 * a diagnostic surface can report a status without ever holding a credential.
 */
export function providerProbes(): Array<{ provider: ProviderName; label: string; url: string; headers: Record<string, string> }> {
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  const probes: Array<{ provider: ProviderName; label: string; url: string; headers: Record<string, string> }> = [];
  const gemini = geminiApiKey();
  if (gemini) probes.push({ provider: "gemini", label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/models", headers: bearer(gemini) });
  const groq = groqApiKey();
  if (groq) probes.push({ provider: "groq", label: "Groq", url: "https://api.groq.com/openai/v1/models", headers: bearer(groq) });
  const hf = huggingFaceToken();
  if (hf) probes.push({ provider: "huggingface", label: "Hugging Face", url: "https://router.huggingface.co/v1/models", headers: bearer(hf) });
  const cerebras = cerebrasApiKey();
  if (cerebras) probes.push({ provider: "cerebras", label: "Cerebras", url: "https://api.cerebras.ai/v1/models", headers: bearer(cerebras) });
  const openrouter = openRouterApiKey();
  if (openrouter) probes.push({ provider: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1/models", headers: bearer(openrouter) });
  const mistral = mistralApiKey();
  if (mistral) probes.push({ provider: "mistral", label: "Mistral", url: "https://api.mistral.ai/v1/models", headers: bearer(mistral) });
  return probes;
}

export function createProviderModel(route: ProviderRoute, origin: string): any {
  if (route.provider === "gemini") {
    const apiKey = geminiApiKey();
    if (!apiKey) throw new Error("A Gemini API credential is not configured.");
    const provider = createOpenAICompatible({
      name: "gemini",
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  if (route.provider === "groq") {
    const apiKey = groqApiKey();
    if (!apiKey) throw new Error("A Groq API credential is not configured.");
    const provider = createOpenAICompatible({
      name: "groq",
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  /* All three optional tiers speak the OpenAI-compatible protocol, so they
     need a base URL and a key and nothing else. */
  if (route.provider === "cerebras") {
    const apiKey = cerebrasApiKey();
    if (!apiKey) throw new Error("A Cerebras API credential is not configured.");
    const provider = createOpenAICompatible({
      name: "cerebras",
      apiKey,
      baseURL: "https://api.cerebras.ai/v1",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  if (route.provider === "openrouter") {
    const apiKey = openRouterApiKey();
    if (!apiKey) throw new Error("An OpenRouter API credential is not configured.");
    const provider = createOpenAICompatible({
      name: "openrouter",
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      includeUsage: true,
      // OpenRouter attributes free-tier usage by referer and title.
      headers: { "HTTP-Referer": origin, "X-Title": "NaviOS" }
    });
    return provider.chatModel(route.model);
  }

  if (route.provider === "mistral") {
    const apiKey = mistralApiKey();
    if (!apiKey) throw new Error("A Mistral API credential is not configured.");
    const provider = createOpenAICompatible({
      name: "mistral",
      apiKey,
      baseURL: "https://api.mistral.ai/v1",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  const apiKey = huggingFaceToken();
  if (!apiKey) throw new Error("A Hugging Face API credential is not configured.");
  const provider = createOpenAICompatible({
    name: "huggingface",
    apiKey,
    baseURL: "https://router.huggingface.co/v1",
    includeUsage: true,
    headers: {
      "HTTP-Referer": origin,
      "X-Title": "NaviOS"
    }
  });
  return provider.chatModel(route.model);
}

const hfPolicy = process.env.HF_ROUTING_POLICY === "fastest" ? "fastest" : "cheapest";
const hf = (model: string, label: string, capability: ProviderRoute["capability"]): ProviderRoute => ({
  provider: "huggingface",
  model: `${model}:${hfPolicy}`,
  label,
  capability
});

export const ROUTES = {
  geminiVision: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    label: "Gemini",
    capability: "multimodal"
  },
  geminiSynthesis: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    label: "Gemini",
    capability: "long-context"
  },
  groqReasoning: {
    provider: "groq",
    model: process.env.GROQ_REASONING_MODEL ?? "openai/gpt-oss-120b",
    label: "Groq reasoning",
    capability: "reasoning"
  },
  groqFast: {
    provider: "groq",
    model: process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b",
    label: "Groq fast",
    capability: "fast"
  },
  /* The route chosen when the request needs tools, so it has to be a model
     that accepts a `tools` array. Groq's `compound` systems do their own
     searching and reject one, which failed every tool-enabled request. */
  groqTools: {
    provider: "groq",
    model: process.env.GROQ_TOOL_MODEL ?? "openai/gpt-oss-120b",
    label: "Groq tools",
    capability: "tools"
  },
  /* Cerebras serves very large open weights at unusual speed, which makes it
     the best High-effort brain available on a free tier — the one place the
     app's ceiling actually moves. */
  cerebrasLarge: {
    provider: "cerebras",
    model: process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
    label: "Cerebras 70B",
    capability: "reasoning"
  },
  cerebrasFast: {
    provider: "cerebras",
    model: process.env.CEREBRAS_FAST_MODEL ?? "llama3.1-8b",
    label: "Cerebras fast",
    capability: "fast"
  },
  /* OpenRouter is breadth rather than depth: one key, many models, and the
     `:free` suffix keeps it on the free tier. */
  openRouterReasoning: {
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-r1:free",
    label: "OpenRouter reasoning",
    capability: "reasoning"
  },
  openRouterCoding: {
    provider: "openrouter",
    model: process.env.OPENROUTER_CODE_MODEL ?? "qwen/qwen-2.5-coder-32b-instruct:free",
    label: "OpenRouter coding",
    capability: "coding"
  },
  mistralBalanced: {
    provider: "mistral",
    model: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
    label: "Mistral Large",
    capability: "balanced"
  },

  hfGptOss: hf("openai/gpt-oss-120b", "HF GPT-OSS 120B", "reasoning"),
  hfDeepSeek: hf("deepseek-ai/DeepSeek-V3.2", "HF DeepSeek V3.2", "reasoning"),
  hfGlm: hf("zai-org/GLM-5.2", "HF GLM 5.2", "long-context"),
  hfQwen: hf("Qwen/Qwen3.6-35B-A3B", "HF Qwen 3.6", "multimodal"),
  hfKimi: hf("moonshotai/Kimi-K2.6", "HF Kimi K2.6", "coding"),
  hfMiniMax: hf("MiniMaxAI/MiniMax-M2.7", "HF MiniMax M2.7", "balanced"),

  /* Long-established weights kept as the tail of the pool. Leading-edge model
     ids are renamed or retired often; a council whose whole pool 404s produces
     nothing, so these broaden capability coverage and act as the fallback. */
  hfDeepSeekR1: hf("deepseek-ai/DeepSeek-R1", "HF DeepSeek R1", "reasoning"),
  hfLlama70b: hf("meta-llama/Llama-3.3-70B-Instruct", "HF Llama 3.3 70B", "balanced"),
  hfQwenCoder: hf("Qwen/Qwen2.5-Coder-32B-Instruct", "HF Qwen2.5 Coder 32B", "coding"),
  hfQwen72b: hf("Qwen/Qwen2.5-72B-Instruct", "HF Qwen2.5 72B", "long-context"),
  hfMistralSmall: hf("mistralai/Mistral-Small-24B-Instruct-2501", "HF Mistral Small 24B", "fast"),
  hfGptOssFast: hf("openai/gpt-oss-20b", "HF GPT-OSS 20B", "fast")
} satisfies Record<string, ProviderRoute>;

/**
 * These providers handle tool calling reliably. The Hugging Face router fronts
 * many open models, plenty of which reject a tools parameter outright, so
 * sending one there would break routes that work today — it is the one
 * provider deliberately left out.
 */
const TOOL_CAPABLE_PROVIDERS: ProviderName[] = ["gemini", "groq", "cerebras", "openrouter", "mistral"];

/**
 * Models that reject a `tools` parameter even though their provider accepts
 * one. Groq's compound systems are agentic in their own right — they search
 * and run code internally — and answer an incoming tools array with a hard
 * `tool calling is not supported with this model`, failing the whole request.
 *
 * Matched on the model id rather than the route name so an operator pointing
 * GROQ_TOOL_MODEL at one of them degrades to no-tools instead of to an error.
 */
const TOOL_INCAPABLE_MODELS = [/^groq\/compound/i];

export function routeToolCallingSupport(route: ProviderRoute): ToolCallingSupport {
  if (!TOOL_CAPABLE_PROVIDERS.includes(route.provider)) return "none";
  if (TOOL_INCAPABLE_MODELS.some((pattern) => pattern.test(route.model))) return "none";
  return "custom";
}

function configuredHfRoutes(): ProviderRoute[] {
  const custom = process.env.HF_SWARM_MODELS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((model, index) => hf(model, `NaviSol · analysis ${index + 1}`, "balanced"));
  if (custom?.length) return custom;

  /* Capability-ordered so a council of any size still spans reasoning,
     coding, long context, multimodal, and fast routes rather than stacking
     several models with the same strengths. */
  return [
    ROUTES.hfGptOss,
    ROUTES.hfDeepSeek,
    ROUTES.hfGlm,
    ROUTES.hfKimi,
    ROUTES.hfQwen,
    ROUTES.hfMiniMax,
    ROUTES.hfDeepSeekR1,
    ROUTES.hfQwenCoder,
    ROUTES.hfQwen72b,
    ROUTES.hfLlama70b,
    ROUTES.hfMistralSmall,
    ROUTES.hfGptOssFast
  ];
}

export function availableSwarmRoutes(availability: ProviderAvailability, tools: ToolPolicy): ProviderRoute[] {
  const hfRoutes = availability.huggingface ? configuredHfRoutes() : [];
  const routes: ProviderRoute[] = [];

  /* A council is only as good as the spread of models in it, so the strongest
     optional routes are interleaved near the front rather than appended. */
  if (availability.cerebras) routes.push(ROUTES.cerebrasLarge);
  if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
  if (hfRoutes[0]) routes.push(hfRoutes[0]);
  if (availability.openrouter) routes.push(ROUTES.openRouterReasoning);
  if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
  if (hfRoutes[1]) routes.push(hfRoutes[1]);
  if (availability.mistral) routes.push(ROUTES.mistralBalanced);
  if (availability.groq) routes.push(ROUTES.groqFast);
  if (availability.openrouter) routes.push(ROUTES.openRouterCoding);
  if (hfRoutes[2]) routes.push(hfRoutes[2]);
  if (availability.cerebras) routes.push(ROUTES.cerebrasFast);
  routes.push(...hfRoutes.slice(3));
  return routes;
}

/**
 * Lane selection: which tier of engine a request deserves.
 *
 * Lane 3 is the only rationed one, so it is the only lane that has to earn its
 * turn. It is spent on requests where a stronger model changes the answer —
 * high effort, or genuinely hard code — and never on a follow-up that a fast
 * route answers just as well.
 */
export type Lane = 1 | 2 | 3 | 4;

export function selectLane(options: {
  mode: "chat" | "code";
  effort: "low" | "medium" | "high";
  complex: boolean;
  hasFiles: boolean;
  longContext: boolean;
}): Lane {
  const { mode, effort, complex, hasFiles, longContext } = options;
  // Attachments need the multimodal route regardless of how hard the ask is.
  if (hasFiles) return 2;
  // Whole-repository reading is a context problem, not a reasoning one.
  if (longContext) return 4;
  if (effort === "high") return 3;
  if (mode === "code") return complex ? 3 : 4;
  if (effort === "low") return 1;
  return complex ? 3 : 2;
}

export function selectDirectRoute(options: {
  preset: ModelPreset;
  availability: ProviderAvailability;
  hasFiles: boolean;
  tools: ToolPolicy;
  complex: boolean;
}): ProviderRoute {
  const { preset, availability, hasFiles, tools, complex } = options;

  if (hasFiles) {
    if (availability.gemini) return ROUTES.geminiVision;
    if (availability.huggingface) return ROUTES.hfQwen;
    throw new Error("File and image input requires Gemini or a Hugging Face vision route.");
  }

  /* Code mode prefers models that lead code benchmarks over generalists.
     Effort (arriving here as `complex`) decides between the strongest coding
     route and the everyday one; tool use still needs a tool-capable provider. */
  if (preset === "navi-code") {
    if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;
    if (complex && availability.openrouter) return ROUTES.openRouterCoding;
    if (complex && availability.cerebras) return ROUTES.cerebrasLarge;
    if (availability.huggingface) return complex ? ROUTES.hfDeepSeek : ROUTES.hfKimi;
    if (availability.cerebras) return ROUTES.cerebrasFast;
    if (availability.groq) return complex ? ROUTES.groqReasoning : ROUTES.groqFast;
    if (availability.gemini) return ROUTES.geminiSynthesis;
    throw new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in your Vercel project settings, then redeploy.");
  }

  if (preset === "huggingface-direct") {
    if (!availability.huggingface) throw new Error("Hugging Face is not configured. Add HF_TOKEN in Vercel, or pick a different model.");
    return complex ? ROUTES.hfGptOss : ROUTES.hfQwen;
  }
  if (preset === "gemini-direct") {
    if (!availability.gemini) throw new Error("Gemini is not configured. Add GEMINI_API_KEY in Vercel, or pick a different model.");
    return ROUTES.geminiSynthesis;
  }
  if (preset === "groq-direct") {
    if (!availability.groq) throw new Error("Groq is not configured. Add GROQ_API_KEY in Vercel, or pick a different model.");
    return tools.web || tools.code ? ROUTES.groqTools : complex ? ROUTES.groqReasoning : ROUTES.groqFast;
  }

  if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;
  /* High effort promises the strongest brain available. Cerebras leads that
     order because it serves the largest weights on a free tier fast enough to
     stay inside the request budget. */
  if (complex && availability.cerebras) return ROUTES.cerebrasLarge;
  if (complex && availability.openrouter) return ROUTES.openRouterReasoning;
  if (complex && availability.huggingface) return ROUTES.hfGptOss;
  if (complex && availability.groq) return ROUTES.groqReasoning;
  if (complex && availability.mistral) return ROUTES.mistralBalanced;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.huggingface) return ROUTES.hfQwen;
  if (availability.cerebras) return ROUTES.cerebrasFast;
  if (availability.groq) return ROUTES.groqFast;
  if (availability.mistral) return ROUTES.mistralBalanced;
  if (availability.openrouter) return ROUTES.openRouterReasoning;
  throw new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in your Vercel project settings, then redeploy.");
}

/**
 * Alternates to try when the chosen route fails outright.
 *
 * A provider returning 403 — a key with referrer or IP restrictions, a
 * disabled API, a revoked token — took the whole app down while four other
 * configured providers sat idle. Selecting one route and betting the request
 * on it is the wrong shape for a system whose whole premise is several free
 * tiers.
 *
 * Ordered to change provider first: retrying a different model on the same
 * provider repeats whatever went wrong at the account level, which is where
 * these failures actually live.
 */
export function fallbackRoutes(options: {
  primary: ProviderRoute;
  availability: ProviderAvailability;
  complex: boolean;
}): ProviderRoute[] {
  const { primary, availability, complex } = options;
  const candidates: ProviderRoute[] = [];
  if (availability.gemini) candidates.push(ROUTES.geminiSynthesis);
  if (availability.groq) candidates.push(complex ? ROUTES.groqReasoning : ROUTES.groqFast);
  if (availability.cerebras) candidates.push(complex ? ROUTES.cerebrasLarge : ROUTES.cerebrasFast);
  if (availability.mistral) candidates.push(ROUTES.mistralBalanced);
  if (availability.openrouter) candidates.push(ROUTES.openRouterReasoning);
  if (availability.huggingface) candidates.push(complex ? ROUTES.hfGptOss : ROUTES.hfQwen);

  const seen = new Set<ProviderName>([primary.provider]);
  const ordered: ProviderRoute[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.provider)) continue;
    seen.add(candidate.provider);
    ordered.push(candidate);
  }
  // Two alternates is enough: a third costs more latency than it recovers.
  return ordered.slice(0, 2);
}

export function selectSynthesisRoute(availability: ProviderAvailability, profile: "navi-5" | "navi-sol-5-6"): ProviderRoute {
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (profile === "navi-sol-5-6" && availability.huggingface) return ROUTES.hfGptOss;
  if (profile === "navi-5" && availability.huggingface) return ROUTES.hfGlm;
  // Synthesis reads every specialist answer, so it wants headroom.
  if (availability.cerebras) return ROUTES.cerebrasLarge;
  if (availability.openrouter) return ROUTES.openRouterReasoning;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.mistral) return ROUTES.mistralBalanced;
  throw new Error("No synthesis provider is configured.");
}

export function selectVerificationRoute(
  availability: ProviderAvailability,
  synthesisProvider: ProviderName,
  profile: "navi-5" | "navi-sol-5-6"
): ProviderRoute {
  if (synthesisProvider !== "groq" && availability.groq) return ROUTES.groqReasoning;
  if (synthesisProvider !== "huggingface" && availability.huggingface) {
    return profile === "navi-sol-5-6" ? ROUTES.hfDeepSeek : ROUTES.hfGptOss;
  }
  if (synthesisProvider !== "gemini" && availability.gemini) return ROUTES.geminiSynthesis;
  // A checker that shares the writer's provider shares its blind spots.
  if (synthesisProvider !== "cerebras" && availability.cerebras) return ROUTES.cerebrasLarge;
  if (synthesisProvider !== "openrouter" && availability.openrouter) return ROUTES.openRouterReasoning;
  if (synthesisProvider !== "mistral" && availability.mistral) return ROUTES.mistralBalanced;
  if (availability.huggingface) return ROUTES.hfGptOss;
  if (availability.groq) return ROUTES.groqReasoning;
  return ROUTES.geminiSynthesis;
}
