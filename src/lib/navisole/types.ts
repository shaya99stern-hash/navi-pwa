export type AgentRole = 'ARCHITECT' | 'CODER' | 'RESEARCHER' | 'SYNTHESIZER';

export interface ModelEndpoint {
  id: string;
  name: string;
  provider: 'groq' | 'cerebras' | 'gemini' | 'openrouter';
  modelId: string;
  speedTps: number;
  contextWindow: number;
  apiKeyEnv: string;
}

export interface NavisoleMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentUsed?: string;
  timestamp: string;
  artifact?: {
    id: string;
    title: string;
    type: 'code' | 'html' | 'react' | 'markdown' | 'svg';
    language: string;
    content: string;
  };
}
