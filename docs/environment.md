# Environment variables

Everything here is optional except a provider credential. The app degrades
rather than breaks: an absent key switches its feature off and says so, it
never fails silently.

All of these go in the same place:

> Vercel → your project → **Settings** → **Environment Variables** → add the
> name and value, tick **Production** (and Preview if you want it on preview
> deployments), save, then **redeploy**.

A new value does not reach a running deployment. Nothing changes until the
redeploy finishes.

## Answering at all — at least one required

| Variable | Gets you |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio. Vision and long context. |
| `GROQ_API_KEY` | Groq. The fastest routes, and tool calling. |
| `HF_TOKEN` | Hugging Face. The specialist pool, plus **all image and audio generation**. |

Optional additions, each of which joins the routing pool automatically with no
further configuration: `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`,
`MISTRAL_API_KEY`.

## Web search — needed for Research mode to actually search

One of these. Research mode without one of them turns the toggle on but has
nothing to search with, and Navi will tell you so rather than pretending.

| Variable | Notes |
| --- | --- |
| `EXA_API_KEY` | Returns page text, which suits a model well. |
| `TAVILY_API_KEY` | Returns extracted prose. Preferred when several are set. |
Brave is deliberately absent: its perpetual free tier ended in February 2026 and
`BRAVE_SEARCH_API_KEY` is read by no code in this repository.

## Repository and deployment reads

These switch on the GitHub and Vercel tools, which is what lets Navi Code
answer questions about your actual repository and your actual builds rather
than about code in general.

| Variable | How to create it |
| --- | --- |
| `NAVI_GITHUB_TOKEN` | GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained**. Repository access: only the repos you want reachable. Permissions: **Contents: Read**, **Metadata: Read**, **Pull requests: Read**, **Actions: Read**. Nothing needs write access. |
| `NAVI_VERCEL_TOKEN` | Vercel → Account Settings → **Tokens** → create a token scoped to the team that owns the project. |

Both tools are read-only by construction — they list, read, and search. Navi
cannot push, merge, or deploy through them.

## Sign-in (Clerk)

| Variable | Required for |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Sign-in to work at all. Public by design — it ships to the browser. |
| `CLERK_SECRET_KEY` | Server-side session verification. |

### Why `CLERK_SECRET_KEY` is currently absent

It was left out deliberately, not by accident.

Session verification here is done by checking the `__session` JWT's signature
against Clerk's published JWKS. That is a public-key check — it needs no
secret, it works on the edge runtime, and it cannot leak anything if the
verification code is wrong. Adding the secret key was not necessary for
sign-in, so it was not added.

What the secret key would additionally unlock:

- Clerk's **backend API**: the list of a user's active sessions and devices,
  and the ability to revoke one from inside Settings.
- `clerkMiddleware()`, which refuses to start without it. The app currently
  uses its own session resolution instead.

To add it: Clerk Dashboard → your application → **API Keys** → copy the
**Secret key** (`sk_live_…` for production, `sk_test_…` for development) →
add it to Vercel as `CLERK_SECRET_KEY` → redeploy.

Treat it as a real secret. It grants full account-level API access to your
Clerk instance. Do not paste it into a chat, a commit, or a screenshot, and
rotate it in the Clerk dashboard if it is ever exposed.

## Media generation tuning

Defaults are chosen already; these only exist to override them.

| Variable | Default | What it changes |
| --- | --- | --- |
| `NAVI_MUSIC_MODEL` | `facebook/musicgen-stereo-large` | Music generation. |
| `NAVI_EFFECT_MODEL` | `facebook/musicgen-small` | Short cues and dings — small on purpose, since a cue is over before a large model has finished its first bar. |
| `NAVI_VOICE_MODEL` | `suno/bark` | Speech. |
| `GEMINI_MODEL`, `GROQ_REASONING_MODEL`, `GROQ_FAST_MODEL`, `GROQ_TOOL_MODEL` | see `lib/ai/providers.ts` | Text routes. `GROQ_TOOL_MODEL` must name a model that accepts a `tools` array. |
