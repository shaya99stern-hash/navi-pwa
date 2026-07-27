import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelPreset, ProviderName, ProviderRoute, ToolPolicy } from "./types";

export type ProviderAvailability = Record<ProviderName, boolean>;

function huggingFaceToken(): string | undefined {
  return process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY ?? process.env.HUGGING_FACE_API_KEY;
}

export function getProviderAvailability(): ProviderAvailability {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    huggingface: Boolean(huggingFaceToken())
  };
}

export function createProviderModel(route: ProviderRoute, origin: string): any {
  if (route.provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const provider = createOpenAICompatible({
      name: "gemini",
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  if (route.provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
    const provider = createOpenAICompatible({
      name: "groq",
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      includeUsage: true
    });
    return provider.chatModel(route.model);
  }

  const apiKey = huggingFaceToken();
  if (!apiKey) throw new Error("HF_TOKEN is not configured.");
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
  const routes: ProviderRoute[] = [];
  if (availability.huggingface) routes.push(...configuredHfRoutes());
  if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
  if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning, ROUTES.groqFast);
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
    if (!availability.huggingface) throw new Error("HF_TOKEN is not configured.");
    return complex ? ROUTES.hfGptOss : ROUTES.hfQwen;
  }
  if (preset === "gemini-direct") {
    if (!availability.gemini) throw new Error("GEMINI_API_KEY is not configured.");
    return ROUTES.geminiSynthesis;
  }
  if (preset === "groq-direct") {
    if (!availability.groq) throw new Error("GROQ_API_KEY is not configured.");
    return tools.web || tools.code ? ROUTES.groqTools : complex ? ROUTES.groqReasoning : ROUTES.groqFast;
  }

  if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;
  if (complex && availability.huggingface) return ROUTES.hfGptOss;
  if (complex && availability.groq) return ROUTES.groqReasoning;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.huggingface) return ROUTES.hfQwen;
  if (availability.groq) return ROUTES.groqFast;
  throw new Error("No Gemini, Groq, or Hugging Face credential is configured in Vercel.");
}

export function selectSynthesisRoute(availability: ProviderAvailability, profile: "navi-5" | "navi-sol-5-6"): ProviderRoute {
  if (profile === "navi-sol-5-6" && availability.huggingface) return ROUTES.hfGptOss;
  if (profile === "navi-5" && availability.huggingface) return ROUTES.hfGlm;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.huggingface) return ROUTES.hfGptOss;
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
