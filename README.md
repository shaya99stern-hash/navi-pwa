# Navi PWA

Navi is a self-contained Next.js App Router PWA with an iOS-first chat interface, local on-device conversation history, streaming responses, and free-tier routing through OpenRouter and Groq.

## Vercel environment variables

Add at least one of these server-side variables in Vercel Project Settings:

- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`

Do not prefix them with `NEXT_PUBLIC_`.

## Free-only routes

- OpenRouter: `openrouter/free`
- Groq: `openai/gpt-oss-120b`
- Groq: `llama-3.3-70b-versatile`
- Groq: `llama-3.1-8b-instant`

Availability and rate limits are controlled by each provider. The application does not contain paid model IDs.
