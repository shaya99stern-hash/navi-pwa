# NAVIOS-PARITY-3.5.md

## Claude-Parity Capability Layer — insert between Task 3 and Task 4 of NAVIOS-HANDOFF.md

**Status:** Blocking. Do not begin Task 4 until Phase A and Phase B ship green.
**Owner:** Claude Code (Opus 5)
**Prereq:** Tasks 1–3 of NAVIOS-HANDOFF.md complete.

-----

## 0. HOW TO USE THIS DOCUMENT

This is a spec, not a prompt. Read it once end to end before writing code.

Work phase by phase. **Each phase has a gate.** Do not start the next phase until the current gate passes on a real device (iOS Safari, installed as PWA — not desktop Chrome).

Phases A and B are the product. Phases C and D are the multiplier. If you run out of budget or hit a wall, stop at the end of a phase, never mid-phase.

When something in this document conflicts with NAVIOS-HANDOFF.md, **this document wins** for anything inside its scope, and the handoff wins for everything else.

-----

## 1. NON-NEGOTIABLES

These apply to every line of code in this document.

1. **Free tier only.** Every service used must have a real free tier that supports production traffic. Anything metered goes behind the existing DeepSeek spend-ceiling ledger with a hard server-side stop. No exceptions, no “just for testing” keys.
1. **No provider names in user-visible text. Ever.** Not in errors, not in banners, not in loading states, not in logs the user can see. The user talks to NaviSol. NaviSol has no vendors.
1. **Failover is silent.** When a lane fails, the next lane takes over and the user sees nothing but a slightly slower response. A visible error is a last resort after every lane has failed.
1. **One error state per failure.** Never stack a banner and an inline message for the same event.
1. **Copy rule:** the assistant is **NaviSol** (capital N, capital S). The app is **NaviOS**. The string `Navi` alone must not appear anywhere in the UI. Grep for it before every commit.
1. **Runtime split is mandatory.** See §4.2. Getting this wrong will break streaming.

-----

## 2. WHY PHASE A COMES FIRST

The app currently reads as low quality for reasons that are almost entirely presentation, not capability:

- It hedges and rambles instead of answering.
- It narrates its own infrastructure failures to the user.
- Messages render as flat text — no code affordances, no visual rhythm, wrong line height for a phone.
- Tool activity, where it exists, is exposed as raw structured output.

None of that is fixed by adding tools. All of it is fixed in days. **Ship Phase A first so the app stops feeling broken while the hard work happens.**

-----

# PHASE A — FEEL PARITY

Target: 2–3 days. No new dependencies. No new services.

## A1. Response discipline (system prompt)

Rewrite the NaviSol system prompt. The current prompt produces hedging. Replace with these behavioral rules, phrased as direct instruction:

```
- Lead with the answer. No preamble, no restating the question, no "Great question."
- Simple questions get 1–2 sentences. Complex ones get at most two phone screenfuls
  unless the user asks to go deeper.
- Never say "I think", "I believe", "it seems", "you know", "essentially", or
  "it's important to note". State the thing or say you don't know it.
- Never describe your own limitations unless directly asked. Never mention models,
  providers, lanes, or infrastructure.
- Use lists when the content is genuinely list-shaped. Use prose when it isn't.
- Code blocks always carry a language tag.
- If you don't know, say so in one sentence and say what would resolve it.
```

Keep the prompt under 1,200 tokens. Route anything longer to a lazily-loaded file. A bloated system prompt costs latency on every single turn.

**Mode-specific:** NaviOS Chat and NaviOS Code load different prompt bodies over a shared base. Do not ship one prompt with `if mode ===` branches inside it.

## A2. Silent failover

Fixes known bugs #1, #2, #3 from the handoff.

Implement in the chat route:

```ts
// lanes are ordered; each entry is a full provider config
async function generate(lanes, opts) {
  const failures = [];
  for (const lane of lanes) {
    try {
      return await lane.run(opts);          // first success wins, silently
    } catch (err) {
      failures.push({ lane: lane.id, err }); // server-side telemetry only
      continue;
    }
  }
  throw new AllLanesFailedError(failures);   // only now does the user see anything
}
```

Requirements:

- Failover happens **before** the first token is emitted. Once streaming has begun, do not switch lanes mid-stream — finish or fail cleanly.
- `AllLanesFailedError` renders as exactly one inline message in the thread. Not a banner. Not a toast. Not both.
- The user-facing string names no provider and does not apologize. Errors state what happened and what to do:
  `"That didn't go through. Tap to retry."`
- All provider detail goes to server logs only.

## A3. Message rendering

This is the single biggest perceived-quality gap. Build a proper markdown renderer for assistant messages.

**Required:**

- Fenced code blocks: syntax highlighting, language label, copy button, horizontal scroll (never wrap code), monospace at 13px with 1.5 line height.
- Inline code: subtle background, no border, slightly reduced size.
- Tables: horizontally scrollable container, sticky header row.
- Lists: correct nesting indent, tightened vertical rhythm — mobile lists currently read as too loose.
- Body text: 16px minimum (iOS zooms below this), line height 1.6, max ~70 characters per line.
- Headings: no more than three visual levels. `h1` in a chat message is wrong; scale down.
- Links: distinguishable without relying on color alone.
- Streaming: render markdown progressively. Never wait for the full response to parse.

**Explicitly:** do not introduce a new design language here. Match what NaviOS already has. This task is typography and affordances, not a redesign.

## A4. Tool activity UI

When tools land in Phase B they must already have a home. Build the component now.

- Collapsed by default: a single-line chip with an icon and a plain verb — `Searching the web`, `Running code`, `Reading repository`.
- Present tense while running, past tense when done: `Searched the web · 4 sources`.
- Tapping expands to show the query and a result summary. **Never** raw JSON in the collapsed state.
- Multiple tool calls in one turn stack as separate chips in call order.
- A failed tool call shows as a neutral chip (`Search unavailable`), not a red error. The model continues.

### GATE A

On a physical iPhone, installed to home screen:

- [ ] Kill the primary provider key. Send a message. User sees a normal answer, no error, no provider name.
- [ ] Ask for a code sample. Block renders highlighted with a working copy button.
- [ ] `grep -rn "Navi[^SO]" src/` returns nothing user-facing.
- [ ] Read three responses aloud. If any contains a hedge phrase from A1, the prompt isn’t done.

-----

# PHASE B — TOOL SPINE

This is what makes NaviSol able to *do* things. Target: 1 week.

## B1. Tool registry

One registry. Every capability — local or remote, built-in or MCP — is registered the same way and appears to the model as one flat tool list.

```
src/lib/tools/
  registry.ts        // single source of truth; exports buildToolset(mode, userId)
  definitions/
    web-search.ts
    web-fetch.ts
    code-execute.ts
    github-read.ts
    github-write.ts
  execute.ts         // shared wrapper: auth, rate limit, cache, spend ledger, telemetry
```

**Rules:**

- `buildToolset` returns only the tools valid for the current mode and user. NaviOS Chat does not get repository write tools.
- Every tool definition is ~30 lines: description, `inputSchema` (zod), `execute`. Business logic lives in a service module, not in the tool file.
- Tool descriptions are written for a model, not a human. State exactly what it does, what it returns, and when *not* to use it.
- Cap the toolset at roughly 12 active tools. Beyond that, model tool-selection accuracy degrades and every turn pays the schema cost.

## B2. The loop (AI SDK 7)

Verified against AI SDK 7 docs. **Do not substitute API names from memory — v5/v6 differ.**

```ts
import { streamText, isStepCount } from 'ai';
import { buildToolset } from '@/lib/tools/registry';

const result = streamText({
  model,
  messages,
  tools: await buildToolset(mode, userId),
  stopWhen: isStepCount(8),        // AI SDK 7. NOT stepCountIs (v5), NOT maxSteps (v4).
  prepareStep: async ({ messages, stepNumber }) => {
    // return { messages } to compact history between steps — this is the hook
    // Task 8 (context compaction) should use. It carries forward to later steps.
    return undefined;
  },
  onStepFinish: ({ toolCalls, toolResults }) => {
    // stream tool chips to the client here
  },
});
```

Notes that will save you a debugging cycle:

- `stopWhen` is only evaluated when the last step contains tool results.
- The default is 20 steps. 8 is deliberate — it bounds latency and cost on a phone.
- Tool results feed back automatically; do not hand-roll the append loop.

## B3. Runtime split — READ THIS BEFORE WRITING ROUTES

Chat routes are currently Edge for time-to-first-token. **Tool execution cannot all live on Edge.**

|Route              |Runtime |Why                       |
|-------------------|--------|--------------------------|
|`/api/chat`        |`edge`  |TTFT. Keep it.            |
|`/api/tools/search`|`edge`  |Plain fetch, no heavy deps|
|`/api/tools/fetch` |`edge`  |Plain fetch               |
|`/api/tools/code`  |`nodejs`|Sandbox SDK needs Node    |
|`/api/tools/github`|`nodejs`|Octokit / crypto          |
|`/api/mcp/*`       |`nodejs`|MCP transports need Node  |

The chat route calls tool routes over HTTP. It does not import their modules. Getting this wrong produces build failures that look like dependency errors and waste hours.

## B4. Web search + fetch

**Service: Tavily.** 1,000 credits/month free, results pre-ranked for LLM context.

- `web_search(query, maxResults=5)` → title, url, snippet, score
- `web_fetch(url)` → cleaned text, capped at ~8k tokens

**Required:**

- Cache by normalized query in Supabase for 1 hour. Without caching the free tier dies at ~30 real users.
- Track credits consumed in the spend ledger. At 90% of monthly quota, disable the tool and let NaviSol answer without it — silently.
- `web_fetch` must reject private IP ranges and non-http(s) schemes. This is an SSRF surface.

**Do not use Brave.** Its perpetual free tier was retired in February 2026; new accounts get a one-time $5 credit and a card on file with no spend cap. Any guide recommending “Brave 2,000 free queries” is stale.

## B5. Code execution

**Service: Vercel Sandbox.** GA since January 2026, Firecracker microVMs, already inside the Vercel account this app deploys from.

Free (Hobby) allotment: ~5 active CPU-hours, 420 GB-hours memory, 5,000 sandbox creations, 20 GB transfer, 10 concurrent sandboxes per month. Billing is on **active CPU** — time spent waiting on network or model calls is not charged, which suits this workload well.

- `code_execute(language, source, timeoutMs=30000)` → stdout, stderr, exitCode, artifacts
- Python and Node only. Reject everything else at the schema level.
- One sandbox per conversation, reused across turns; destroy on conversation close or after 10 minutes idle.
- Hard 30s wall clock. Kill and return partial stdout on timeout.
- Count creations against the spend ledger.

Known limits, accept them: single region (US East), no GPU.

## B6. GitHub read + guarded write

Pull Task 15 forward into this phase — it’s the capability that makes NaviOS self-extending, and OAuth tokens are already configured in Vercel.

- `github_read(repo, path, ref?)` → file contents
- `github_search(repo, query)` → matching paths with line context
- `github_write(repo, branch, files[], message)` → **opens a pull request. Never pushes to default branch.**

**Guards, all mandatory:**

- Writes always target a new branch named `navisol/<slug>-<shortid>`.
- Every write returns the PR URL into the conversation. The user merges. NaviSol does not.
- Refuse writes to `.github/workflows/`, any file matching `*.env*`, and any file containing a detected secret pattern.
- A single write call may touch at most 20 files.

### GATE B

- [ ] “What shipped in Next.js this month?” → search chip appears, cited answer follows.
- [ ] “Write and run a Python function that returns the first 20 primes.” → code chip, real output.
- [ ] “Read src/app/layout.tsx and tell me what it does.” → correct summary.
- [ ] “Add a comment to the top of README explaining what NaviOS is.” → PR URL returned, default branch untouched.
- [ ] Revoke the search key. Ask a search question. NaviSol answers from its own knowledge with a neutral chip. No error, no provider name.

-----

# PHASE C — MCP CLIENT

This is the multiplier. One client, and roughly 10,000 public servers become available without further integration work. Every major AI vendor now backs the protocol, and it is governed under the Linux Foundation rather than any single company.

**Package:** `@ai-sdk/mcp`. Verified API:

```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { streamText } from 'ai';

const mcp = await createMCPClient({
  transport: {
    type: 'http',                       // streamable HTTP
    url: server.url,
    headers: { Authorization: `Bearer ${token}` },
    // authProvider: oauthProvider,     // for OAuth-protected servers
  },
});

const mcpTools = await mcp.tools();      // already shaped as AI SDK tools

const result = streamText({
  model,
  messages,
  tools: { ...localTools, ...mcpTools },
  stopWhen: isStepCount(8),
  onEnd: async () => { await mcp.close(); },   // required, or you leak sessions
});
```

Do not use `experimental_createMCPClient` from `ai` — that is the older surface.

**Build:**

1. Server registry table in Supabase: `id, user_id, name, url, transport, auth_type, encrypted_token, enabled`.
1. OAuth 2.1 + PKCE flow for servers that require it. Tokens encrypted at rest.
1. Settings screen: add server by URL, connect, toggle, remove. Show the tool count each server contributes.
1. Namespace incoming tool names (`<server>__<tool>`) to prevent collisions.
1. **Fail open.** If a server is unreachable at request time, drop its tools and continue. Never block a message on a dead connector.
1. Enforce the ~12 active tool cap across local + MCP combined. If the user enables more, require them to choose.

**Security, non-optional:** MCP had real incidents in 2026 — cross-tenant leakage and tool-poisoning among them. Therefore: never auto-enable a server, show the full tool list and description before the user connects, and require explicit confirmation for any MCP tool whose description indicates a write or delete.

### GATE C

- [ ] Connect one public read-only MCP server. Its tools appear and are callable.
- [ ] Disable it. Tools disappear from the next turn’s toolset.
- [ ] Point at an unreachable URL. Chat still works, no user-visible error.

-----

# PHASE D — MEMORY

Supabase, free tier. Two separate systems — do not merge them.

**1. Profile store** — durable facts about the user. Small, capped at ~30 entries, editable and deletable from Settings. Injected into the system prompt only when relevant.

**2. Conversation search** — full-text search across past threads, exposed to the model as a tool:
`search_past_conversations(query)` → matching excerpts with conversation IDs.

This supersedes and absorbs Task 12 of the handoff.

**Rules:**

- The user can see, edit, and delete everything in both systems.
- Never surface a sensitive stored fact unless the user raises the topic first.
- Deleting a conversation removes it from the search index.

-----

## 3. FREE-TIER BUDGET

|Capability    |Service       |Free allotment             |Behavior at limit           |
|--------------|--------------|---------------------------|----------------------------|
|Web search    |Tavily        |1,000 calls/mo             |Disable tool silently at 90%|
|Code execution|Vercel Sandbox|~5 CPU-hrs, 5k creations/mo|Disable tool silently at 90%|
|Repository    |GitHub API    |5,000 req/hr authenticated |Backoff + retry             |
|Connectors    |MCP           |Protocol is free           |Per-server limits apply     |
|Memory        |Supabase      |Free tier                  |Prune oldest embeddings     |
|Model lanes   |existing      |existing ceiling           |existing ledger             |

**Total added recurring cost at hobby scale: $0.**

Image generation has no viable free tier — the good reference-image models run roughly $0.02–0.03 per image. **Out of scope for this document.** It goes to V2 behind its own spend ceiling.

-----

## 4. VERIFICATION — THREE PASSES, NO EXCEPTIONS

Before declaring any phase done:

**Pass 1 — Compile.** `pnpm build` clean. Zero TypeScript errors. No `any` introduced in new files.

**Pass 2 — Behavior.** Every checkbox in that phase’s gate, executed on a physical iPhone with the app installed to the home screen. Desktop Chrome does not count.

**Pass 3 — Regression.** Re-run the Gate A checklist regardless of which phase you just finished. Tool work has a strong tendency to reintroduce leaked provider names and stacked error states.

Report per phase: what shipped, what each gate returned, what you deliberately did not do.

-----

## 5. OUT OF SCOPE → V2 BACKLOG

Do not build these. Append anything else you’re tempted by:

- Image generation (any model, any provider)
- Artifacts / live rendered output
- Voice input/output changes — Task 10 owns this
- Settings two-pane layout — Task 17 owns this
- Multi-agent orchestration, sub-agents
- NaviSol authoring its own tools without human approval
- Any provider or model not already in the lane config

-----

## 6. ANTI-DRIFT RULES

1. If you find yourself redesigning the UI, stop. This document contains no redesign.
1. If a phase exceeds its target by more than double, stop and report rather than pushing through.
1. If you cannot verify an API signature against current documentation, **do not guess it** — flag it and stop. Several APIs referenced here changed names within the last year.
1. Do not refactor code outside the scope of the current phase.
1. If the user’s next instruction appears to conflict with a shipped gate, ask before reversing it.

**End of NAVIOS-PARITY-3.5.md**