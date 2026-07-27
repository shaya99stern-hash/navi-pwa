import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelPreset, ProviderName, ProviderRoute, ToolPolicy } from "./types";

export type ProviderAvailability = Record<ProviderName, boolean>;

export function getProviderAvailability(): ProviderAvailability {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY)
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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
  const provider = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    includeUsage: true,
    headers: {
      "HTTP-Referer": origin,
      "X-OpenRouter-Title": "Navi"
    }
  });
  return provider.chatModel(route.model);
}

export const ROUTES = {
  geminiFlash: { provider: "gemini", model: "gemini-3.6-flash", label: "Gemini Flash", capability: "multimodal" },
  geminiSubagent: { provider: "gemini", model: "gemini-3.5-flash-lite", label: "Gemini Flash-Lite", capability: "fast" },
  groqReasoning: { provider: "groq", model: "openai/gpt-oss-120b", label: "Groq GPT-OSS 120B", capability: "reasoning" },
  groqFast: { provider: "groq", model: "openai/gpt-oss-20b", label: "Groq GPT-OSS 20B", capability: "fast" },
  groqTools: { provider: "groq", model: "groq/compound", label: "Groq Compound", capability: "tools" },
  openRouterFree: { provider: "openrouter", model: "openrouter/free", label: "OpenRouter Free", capability: "balanced" }
} satisfies Record<string, ProviderRoute>;

export function availableDraftRoutes(availability: ProviderAvailability, tools: ToolPolicy): ProviderRoute[] {
  const routes: ProviderRoute[] = [];
  if (availability.gemini) routes.push(ROUTES.geminiSubagent);
  if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
  if (availability.openrouter) routes.push(ROUTES.openRouterFree);
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
    if (!availability.gemini) throw new Error("File and image input requires GEMINI_API_KEY in this deployment.");
    return ROUTES.geminiFlash;
  }

  if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;

  if (preset === "gemini-flash") {
    if (!availability.gemini) throw new Error("GEMINI_API_KEY is not configured.");
    return ROUTES.geminiFlash;
  }

  if (preset === "groq-fast") {
    if (!availability.groq) throw new Error("GROQ_API_KEY is not configured.");
    return ROUTES.groqFast;
  }

  if (preset === "openrouter-free") {
    if (!availability.openrouter) throw new Error("OPENROUTER_API_KEY is not configured.");
    return ROUTES.openRouterFree;
  }

  if (complex && availability.groq) return ROUTES.groqReasoning;
  if (availability.gemini) return ROUTES.geminiFlash;
  if (availability.groq) return ROUTES.groqFast;
  if (availability.openrouter) return ROUTES.openRouterFree;
  throw new Error("No AI provider key is configured in Vercel.");
}

export function selectSynthesisRoute(availability: ProviderAvailability, profile: "fable-5" | "opus-4-8"): ProviderRoute {
  if (profile === "opus-4-8" && availability.groq) return ROUTES.groqReasoning;
  if (availability.gemini) return ROUTES.geminiFlash;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.openrouter) return ROUTES.openRouterFree;
  throw new Error("No synthesis provider is configured.");
}

export function selectVerificationRoute(
  availability: ProviderAvailability,
  synthesisProvider: ProviderName
): ProviderRoute {
  if (synthesisProvider !== "groq" && availability.groq) return ROUTES.groqReasoning;
  if (synthesisProvider !== "gemini" && availability.gemini) return ROUTES.geminiFlash;
  if (synthesisProvider !== "openrouter" && availability.openrouter) return ROUTES.openRouterFree;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.gemini) return ROUTES.geminiFlash;
  return ROUTES.openRouterFree;
}
