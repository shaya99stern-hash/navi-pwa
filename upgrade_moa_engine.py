import os, sys, json

def upgrade_router():
    user = os.environ.get("USERPROFILE", os.path.expanduser("~"))
    repo_dir = os.path.join(user, "navi-pwa") if os.path.exists(os.path.join(user, "navi-pwa")) else "."
    
    src_dir = os.path.join(repo_dir, "src")
    base_dir = src_dir if os.path.exists(src_dir) else repo_dir
    
    lib_router = os.path.join(base_dir, "lib", "router")
    components_dir = os.path.join(base_dir, "components")
    
    for d in [lib_router, components_dir]:
        os.makedirs(d, exist_ok=True)

    print("============================================================")
    print("      UPGRADING NAVIOS TO FREE-TIER MULTI-AGENT ROUTER      ")
    print("============================================================")

    # 1. types.ts
    types_ts = """export type TaskIntent = 
  | 'CODE_ARTIFACT'
  | 'FAST_QA'
  | 'DEEP_SYNTHESIS'
  | 'CREATIVE_WRITING'
  | 'MATH_LOGIC';

export type FreeProviderName = 'cerebras' | 'groq' | 'gemini' | 'openrouter';

export interface FreeModelConfig {
  id: string;
  name: string;
  provider: FreeProviderName;
  modelId: string;
  maxTokens: number;
  speedTps: number;
  contextWindow: number;
  apiKeyEnv: string;
}

export interface RoutingDecision {
  intent: TaskIntent;
  primaryModel: FreeModelConfig;
  fallbackChain: FreeModelConfig[];
  useMoA: boolean;
  reasoning: string;
}

export interface ClientEnvironment {
  isPwa: boolean;
  isMobile: boolean;
  viewportWidth: number;
}
"""
    with open(os.path.join(lib_router, "types.ts"), "w", encoding="utf-8") as f:
        f.write(types_ts)
    print("✓ Created: src/lib/router/types.ts")

    # 2. providers.ts
    providers_ts = """import { FreeModelConfig } from './types';

export const FREE_TIER_MODELS: Record<string, FreeModelConfig> = {
  cerebras_llama70b: {
    id: 'cerebras_llama70b',
    name: 'Cerebras Llama-3.1 70B',
    provider: 'cerebras',
    modelId: 'llama3.1-70b',
    maxTokens: 8192,
    speedTps: 1800,
    contextWindow: 128000,
    apiKeyEnv: 'CEREBRAS_API_KEY'
  },
  groq_llama70b: {
    id: 'groq_llama70b',
    name: 'Groq Llama-3.3 70B Versatile',
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    maxTokens: 8192,
    speedTps: 850,
    contextWindow: 128000,
    apiKeyEnv: 'GROQ_API_KEY'
  },
  gemini_flash: {
    id: 'gemini_flash',
    name: 'Google Gemini 1.5 Flash (Free Tier)',
    provider: 'gemini',
    modelId: 'gemini-1.5-flash',
    maxTokens: 8192,
    speedTps: 350,
    contextWindow: 1000000,
    apiKeyEnv: 'GEMINI_API_KEY'
  },
  openrouter_qwen_coder: {
    id: 'openrouter_qwen_coder',
    name: 'Qwen 2.5 Coder 32B (Free)',
    provider: 'openrouter',
    modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
    maxTokens: 8192,
    speedTps: 200,
    contextWindow: 32768,
    apiKeyEnv: 'OPENROUTER_API_KEY'
  }
};
"""
    with open(os.path.join(lib_router, "providers.ts"), "w", encoding="utf-8") as f:
        f.write(providers_ts)
    print("✓ Created: src/lib/router/providers.ts")

    # 3. intentClassifier.ts
    classifier_ts = """import { TaskIntent, RoutingDecision } from './types';
import { FREE_TIER_MODELS } from './providers';

export function classifyAndRoute(userPrompt: string): RoutingDecision {
  const text = userPrompt.toLowerCase();
  
  // Code & Artifact Intent
  if (
    text.includes('code') ||
    text.includes('component') ||
    text.includes('html') ||
    text.includes('script') ||
    text.includes('function') ||
    text.includes('artifact') ||
    text.includes('react') ||
    text.includes('typescript')
  ) {
    return {
      intent: 'CODE_ARTIFACT',
      primaryModel: FREE_TIER_MODELS.groq_llama70b,
      fallbackChain: [
        FREE_TIER_MODELS.cerebras_llama70b,
        FREE_TIER_MODELS.gemini_flash,
        FREE_TIER_MODELS.openrouter_qwen_coder
      ],
      useMoA: false,
      reasoning: 'Routed to Groq/Cerebras 70B for zero-latency code generation with OpenRouter/Gemini fallback.'
    };
  }

  // Deep Research & Synthesis Intent
  if (
    text.includes('analyze') ||
    text.includes('audit') ||
    text.includes('compare') ||
    text.includes('research') ||
    text.includes('summarize') ||
    text.length > 600
  ) {
    return {
      intent: 'DEEP_SYNTHESIS',
      primaryModel: FREE_TIER_MODELS.gemini_flash,
      fallbackChain: [
        FREE_TIER_MODELS.groq_llama70b,
        FREE_TIER_MODELS.cerebras_llama70b
      ],
      useMoA: true,
      reasoning: 'Routed to Gemini 1.5 Flash (1M Context) for multi-source synthesis with MoA drafting.'
    };
  }

  // Fast Conversational / Default QA
  return {
    intent: 'FAST_QA',
    primaryModel: FREE_TIER_MODELS.cerebras_llama70b,
    fallbackChain: [
      FREE_TIER_MODELS.groq_llama70b,
      FREE_TIER_MODELS.gemini_flash
    ],
    useMoA: false,
    reasoning: 'Ultra-low latency conversational mode (~1,800 tokens/sec) on Cerebras.'
  };
}
"""
    with open(os.path.join(lib_router, "intentClassifier.ts"), "w", encoding="utf-8") as f:
        f.write(classifier_ts)
    print("✓ Created: src/lib/router/intentClassifier.ts")

    # 4. AgentTelemetryBadge.tsx
    badge_tsx = """import React from 'react';

interface AgentTelemetryBadgeProps {
  providerName: string;
  modelName: string;
  speedTps?: number;
  latencyMs?: number;
  intent?: string;
  isCascading?: boolean;
}

export const AgentTelemetryBadge: React.FC<AgentTelemetryBadgeProps> = ({
  providerName,
  modelName,
  speedTps = 850,
  latencyMs = 45,
  intent = 'Code & Intelligence',
  isCascading = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300 shadow-lg backdrop-blur-md transition-all hover:border-orange-500/40">
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
          isCascading ? 'bg-amber-400' : 'bg-orange-500'
        }`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${
          isCascading ? 'bg-amber-500' : 'bg-orange-500'
        }`} />
      </span>

      <span className="font-semibold text-zinc-100">{modelName}</span>
      <span className="text-zinc-500">•</span>
      <span className="font-mono text-zinc-400">{speedTps} t/s</span>
      <span className="text-zinc-500">•</span>
      <span className="text-orange-400/90">{latencyMs}ms</span>

      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 uppercase tracking-wider">
        {intent}
      </span>
    </div>
  );
};
"""
    with open(os.path.join(components_dir, "AgentTelemetryBadge.tsx"), "w", encoding="utf-8") as f:
        f.write(badge_tsx)
    print("✓ Created: src/components/AgentTelemetryBadge.tsx")

    print("============================================================")
    print("           ROUTER ARCHITECTURE UPGRADE COMPLETE!            ")
    print("============================================================")

upgrade_router()
