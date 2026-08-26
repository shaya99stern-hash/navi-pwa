import { FreeModelConfig } from './types';

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
