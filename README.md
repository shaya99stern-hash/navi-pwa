# Navi

Navi is a self-contained Next.js App Router PWA with a premium mobile shell, local-first IndexedDB history, secure artifact rendering, a unified top control sheet, remote MCP registry support, and free-model provider routing across Gemini, Groq, and OpenRouter.

## Vercel environment variables

Add one or more provider keys in Vercel Project Settings:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Optional:

- `MCP_SERVER_REGISTRY_JSON`
- `NAVI_ENCRYPTION_KEY`
- `NAVI_DEFAULT_MODEL_PRESET`

Never prefix provider keys with `NEXT_PUBLIC_`.
