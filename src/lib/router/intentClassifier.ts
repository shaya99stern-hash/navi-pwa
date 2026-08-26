import { TaskIntent, RoutingDecision } from './types';
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
