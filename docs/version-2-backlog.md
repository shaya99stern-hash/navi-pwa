# Version 2.0 Backlog

Work that came up during v4.x, was deliberately not done, and should not be
rediscovered from scratch later. Each entry records what is wrong, why it was
left, and what it would actually take — so the next person picking it up starts
from the diagnosis rather than the symptom.

Nothing here is in scope for the current handoff. Add to it rather than
widening a task.

---

## Image generation is unavailable

**Symptom.** Asking for a picture returns "NaviSoul's image service is
unavailable right now. Try again shortly." The request routes correctly — the
intent classifier in `app/api/chat/route.ts` identifies it, and
`lib/ai/image-generation.ts` is reached — but no configured engine answers.

**Why it was left.** Every engine in the table is a free inference endpoint,
and free image inference is the least stable tier any of these providers
offers: cold starts run past the edge timeout, queues return 503 under load,
and models get retired without notice. Fixing it inside the existing free-tier
premise means retrying a service that is unreliable by design. That is a
sourcing decision, not a code change, and it does not belong inside a defect
sweep.

**What it would take.**

1. Decide whether image generation is a paid capability. If it is, the work is
   a provider with an SLA, a key in Vercel env, and the same
   `NAVI_MONTHLY_BUDGET_USD` ceiling the text lanes use — not a new pipeline.
2. If it stays free, the engine table needs the same treatment the text lanes
   got: per-engine availability probing, a fallback chain across providers
   rather than across models on one provider, and a cold-start warm-up that
   does not spend the request's budget waiting.
3. Either way the failure needs to degrade honestly. Right now a person cannot
   tell "the service is down" from "this app cannot make pictures at all," and
   those call for different reactions.

**Do not** substitute an SVG or an HTML artifact for a requested raster image.
The system prompt already forbids it, and the reason stands: it looks like a
feature working badly rather than a feature that is off.

---

## Python in the code-execution sandbox

Task 5 ships JavaScript execution in a Web Worker. Python was in the same spec
and is not here.

**Why it was left.** Running Python in a browser means Pyodide, which is several
megabytes of WebAssembly before any user code runs. On a mobile-first PWA over
cellular that is the wrong trade for a capability most turns will not use, and
loading it eagerly would slow every session to serve a few.

**What it would take.** Load it lazily, on the first Python run rather than at
startup, behind a visible "preparing Python" state, and cache it in the service
worker so the cost is paid once per device rather than once per session. Then
decide whether it is opt-in in Settings — a several-megabyte download is a
choice a user on a metered connection should get to make. The sandbox interface
in `lib/execution/sandbox.ts` already returns a neutral `ExecutionResult`, so a
second runtime slots in beside the first without changing the repair loop.

Do **not** solve this by running Python server-side. The reasoning that ruled
out a server sandbox for JavaScript applies unchanged: the edge runtime cannot
isolate a script, and Node's `vm` module is explicitly not a security boundary.

---

## Third-party model names in swarm guardrails

`lib/ai/swarm.ts` carries negative instructions naming specific third-party
models — telling the model not to claim it is one of them. They are guardrails,
never echoed, and they predate the no-provider-names rule. They are still the
only place those names survive in the codebase outside routing internals.

**What it would take.** Restate each guardrail in terms of what the model must
not claim (proprietary weights, training data, benchmark results) without
naming the system it must not claim to be. Verify against the swarm tests that
the identity answers do not regress: the names may be doing work the abstract
phrasing does not.
