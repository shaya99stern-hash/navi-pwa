import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelPreset, ProviderName, ProviderRoute, ToolPolicy } from "./types";

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

export function getGroqApiKey(): string | undefined {
  return groqApiKey();
}

export function getProviderAvailability(): ProviderAvailability {
  return {
    gemini: Boolean(geminiApiKey()),
    groq: Boolean(groqApiKey()),
    huggingface: Boolean(huggingFaceToken())
  };
}

export function getProviderStackStatus() {
  const providers = getProviderAvailability();
  const active = Object.values(providers).filter(Boolean).length;
  return {
    providers,
    active,
    total: 3,
    fullStack: active === 3,
    missing: (Object.entries(providers) as Array<[ProviderName, boolean]>)
      .filter(([, ready]) => !ready)
      .map(([provider]) => provider)
  };
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

  const apiKey = huggingFaceToken();
  if (!apiKey) throw new Error("A Hugging Face API credential is not configured.");
  const provider = createOpenAICompatible({
    name: "huggingface",
    apiKey,
    baseURL: "https://router.huggingface.co/v1",
    includeUsage: true,
    headers: {
      "HTTP-Referer": origin,
      "X-Title": "Navi"
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
  groqTools: {
    provider: "groq",
    model: process.env.GROQ_TOOL_MODEL ?? "groq/compound",
    label: "Groq tools",
    capability: "tools"
  },
  groqToolsMini: {
    provider: "groq",
    model: process.env.GROQ_TOOL_MINI_MODEL ?? "groq/compound-mini",
    label: "Groq tools fast",
    capability: "tools"
  },
  hfGptOss: hf("openai/gpt-oss-120b", "HF GPT-OSS 120B", "reasoning"),
  hfDeepSeek: hf("deepseek-ai/DeepSeek-V3.2", "HF DeepSeek V3.2", "reasoning"),
  hfGlm: hf("zai-org/GLM-5.2", "HF GLM 5.2", "long-context"),
  hfQwen: hf("Qwen/Qwen3.6-35B-A3B", "HF Qwen 3.6", "multimodal"),
  hfKimi: hf("moonshotai/Kimi-K2.6", "HF Kimi K2.6", "coding"),
  hfMiniMax: hf("MiniMaxAI/MiniMax-M2.7", "HF MiniMax M2.7", "balanced")
} satisfies Record<string, ProviderRoute>;

function configuredHfRoutes(): ProviderRoute[] {
  const custom = process.env.HF_SWARM_MODELS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((model, index) => hf(model, `HF specialist ${index + 1}`, "balanced"));
  return custom?.length
    ? custom
    : [ROUTES.hfGptOss, ROUTES.hfDeepSeek, ROUTES.hfGlm, ROUTES.hfQwen, ROUTES.hfKimi, ROUTES.hfMiniMax];
}

export function availableSwarmRoutes(availability: ProviderAvailability, tools: ToolPolicy): ProviderRoute[] {
  const hfRoutes = availability.huggingface ? configuredHfRoutes() : [];
  const routes: ProviderRoute[] = [];

  if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
  if (hfRoutes[0]) routes.push(hfRoutes[0]);
  if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
  if (hfRoutes[1]) routes.push(hfRoutes[1]);
  if (availability.groq) routes.push(ROUTES.groqFast);
  if (hfRoutes[2]) routes.push(hfRoutes[2]);
  routes.push(...hfRoutes.slice(3));
  return routes;
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

  if (preset === "huggingface-direct") {
    if (!availability.huggingface) throw new Error("A Hugging Face API credential is not configured.");
    return complex ? ROUTES.hfGptOss : ROUTES.hfQwen;
  }
  if (preset === "gemini-direct") {
    if (!availability.gemini) throw new Error("A Gemini API credential is not configured.");
    return ROUTES.geminiSynthesis;
  }
  if (preset === "groq-direct") {
    if (!availability.groq) throw new Error("A Groq API credential is not configured.");
    return tools.web || tools.code
      ? (tools.web && tools.code) || complex ? ROUTES.groqTools : ROUTES.groqToolsMini
      : complex ? ROUTES.groqReasoning : ROUTES.groqFast;
  }

  if ((tools.web || tools.code) && availability.groq) {
    return (tools.web && tools.code) || complex ? ROUTES.groqTools : ROUTES.groqToolsMini;
  }
  if (complex && availability.huggingface) return ROUTES.hfGptOss;
  if (complex && availability.groq) return ROUTES.groqReasoning;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.huggingface) return ROUTES.hfQwen;
  if (availability.groq) return ROUTES.groqFast;
  throw new Error("No Gemini, Groq, or Hugging Face credential is configured in Vercel.");
}

export function selectConnectorToolRoute(availability: ProviderAvailability): ProviderRoute {
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.huggingface) return ROUTES.hfGptOss;
  throw new Error("No provider capable of connector tool calling is configured.");
}

export function selectSynthesisRoute(availability: ProviderAvailability, profile: "navi-5" | "navi-sol-5-6"): ProviderRoute {
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (profile === "navi-sol-5-6" && availability.huggingface) return ROUTES.hfGptOss;
  if (profile === "navi-5" && availability.huggingface) return ROUTES.hfGlm;
  if (availability.groq) return ROUTES.groqReasoning;
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
  if (availability.huggingface) return ROUTES.hfGptOss;
  if (availability.groq) return ROUTES.groqReasoning;
  return ROUTES.geminiSynthesis;
}
