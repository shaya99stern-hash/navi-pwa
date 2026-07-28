# Navi

Navi is a self-contained Next.js App Router PWA with a premium mobile shell, local-first IndexedDB history, secure artifact rendering, a unified control sheet, remote MCP support, and private multi-provider AI swarms.

## Navi modes

### Navi 5

Navi Fable is a long-horizon orchestration profile for knowledge work, coding, planning, document understanding, implementation, testing, and constraint preservation. It assigns 72 specialist **role lenses** across up to 8 concurrent council calls (depending on effort and configured providers). Role lenses are prompt assignments, not 72 independently running models. Successful councils are reconciled into a candidate and then verified before one Navi answer is streamed.

### Navi Sol 5.6

Navi Sol is a parallel reasoning profile for research synthesis, coding quality, quantitative checking, design judgment, context continuity, adversarial review, and concise final writing. It assigns 96 specialist **role lenses** across up to 10 concurrent council calls. It does not claim that 96 models run for every request. The frontend never renders private reasoning, internal prompts, or provider routing details.

These are Navi orchestration profiles. They do not contain, redistribute, or claim to be Anthropic or OpenAI proprietary model weights, and they are not represented as benchmark-identical copies of those systems.

## Provider collaboration

When all three credentials are configured, the swarm interleaves:

- Hugging Face routed models for diverse specialist councils
- Gemini for multimodal input and long-context synthesis
- Groq for low-latency reasoning, tool-capable routes, and adversarial verification

The default Hugging Face pool includes GPT-OSS, DeepSeek, GLM, Qwen, Kimi, and MiniMax families. Override profile-specific pools with comma-separated `HF_SOL_MODELS` or `HF_FABLE_MODELS` values. Failed or rate-limited calls are isolated, but the swarm proceeds only when its minimum council-success and provider-diversity thresholds are met. Verifier routes retry once and then fall back to alternate planned routes; if every verifier fails before the deadline, the response is explicitly a candidate fallback rather than a claimed verification.

Composite calls use an end-to-end deadline (default 52 seconds, leaving time for response streaming), cap fan-out history and evidence, and do not duplicate attachment bytes across councils. Attachment analysis should use a direct multimodal mode. Connector metadata and client-provided thread summaries are delimited as untrusted reference data and are never allowed to override Navi instructions.

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
- `HF_ROUTING_POLICY` — profile default is `fastest` for Sol and `preferred` for Fable
- `HF_SOL_MODELS` / `HF_FABLE_MODELS` — comma-separated Hugging Face model IDs for each profile
- `NAVI_SWARM_DEADLINE_MS` — end-to-end composite deadline; clamped to 30–55 seconds
- `NAVI_SOL_MAX_COUNCILS` / `NAVI_FABLE_MAX_COUNCILS` — maximum concurrent council calls, not a role count
- `NAVI_DEFAULT_MODEL_PRESET`
- `MCP_SERVER_REGISTRY_JSON`
- `NAVI_ENCRYPTION_KEY`

Never prefix provider credentials with `NEXT_PUBLIC_`. Free-tier quotas remain provider-controlled; the orchestration degrades gracefully when a council call is unavailable, but it cannot manufacture free inference capacity after a provider quota is exhausted.
