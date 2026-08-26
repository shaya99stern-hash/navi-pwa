export type TaskIntent = 
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
