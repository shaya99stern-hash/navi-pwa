# Navi

Navi is a self-contained Next.js App Router PWA with a premium mobile shell, local-first IndexedDB history, secure artifact rendering, a unified control sheet, remote MCP support, and private multi-provider AI swarms.

## Navi modes

### Navi 5

A 64-role hidden swarm tuned for long-running knowledge work, coding, planning, document understanding, implementation, testing, and constraint preservation. Sixteen specialized roles are grouped into independent councils. Their private outputs are reconciled and verified before a single Navi answer is streamed to the user.

### Navi Sol 5.6

A 96-role hidden swarm tuned for flagship reasoning, research synthesis, coding quality, quantitative checking, design judgment, context continuity, adversarial review, and token-efficient final writing. The frontend never renders internal agent conversations, provider names, scratch work, or private reasoning.

These are Navi orchestration profiles. They do not contain, redistribute, or claim to be Anthropic or OpenAI proprietary model weights, and they are not represented as benchmark-identical copies of those systems.

## Provider collaboration

When all three credentials are configured, the swarm interleaves:

- Hugging Face routed models for diverse specialist councils
- Gemini for multimodal input and long-context synthesis
- Groq for low-latency reasoning, tool-capable routes, and adversarial verification

The default Hugging Face pool includes GPT-OSS, DeepSeek, GLM, Qwen, Kimi, and MiniMax families. Override it with a comma-separated `HF_SWARM_MODELS` value. Failed or rate-limited council calls are isolated with `Promise.allSettled`, so one unavailable model does not invalidate every completed specialist result.

## Vercel environment variables

Add server-side credentials in Vercel Project Settings:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `HF_TOKEN`

Optional routing configuration:

- `GEMINI_MODEL`
- `GROQ_REASONING_MODEL`
- `GROQ_FAST_MODEL`
- `GROQ_TOOL_MODEL`
- `HF_ROUTING_POLICY` — `cheapest` by default or `fastest`
- `HF_SWARM_MODELS` — comma-separated Hugging Face model IDs
- `NAVI_DEFAULT_MODEL_PRESET`
- `MCP_SERVER_REGISTRY_JSON`
- `NAVI_ENCRYPTION_KEY`

Never prefix provider credentials with `NEXT_PUBLIC_`. Free-tier quotas remain provider-controlled; the orchestration degrades gracefully when a council call is unavailable, but it cannot manufacture free inference capacity after a provider quota is exhausted.
