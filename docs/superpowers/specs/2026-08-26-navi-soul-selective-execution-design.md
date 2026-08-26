# Navi Soul Selective Execution Design

## Goal

Make Navi Soul feel substantially faster, smoother, and smarter while preserving its zero-dollar routing and broad capabilities. Small conversational turns must avoid heavyweight context/tool machinery; complex turns must still gain the exact capabilities they need. Artifact generation must self-check cheaply and repair only the broken part. Streaming should feel like a natural model stream rather than a simulated word-by-word typewriter.

## Product outcomes

1. A trivial turn such as `hi`, `thanks`, or `okay` reaches first useful text with minimal deterministic preprocessing and no unrelated tool schemas, MCP discovery, repository retrieval, artifact machinery, council/critique, or broad memory retrieval.
2. Standard turns receive only the context and capability groups justified by the request.
3. Research, code, connector, memory, and artifact turns still receive their needed capabilities; optimization must not make Navi blind.
4. Artifact requests run a deterministic structural quality gate after generation and perform at most one targeted repair when the gate identifies a fixable defect.
5. Provider responses stream in natural bursts. The fixed `smoothStream({ delayInMs: 26, chunking: "word" })` pacing is removed from ordinary text replies.
6. The financial operating mode remains zero-dollar by default. No optimization may re-enable a metered fallback.
7. Existing relevance-aware tool ownership remains in `tool-registry.ts`; the turn resource budget continues to own answer length, tool round-trip depth, mission/model-call depth, and subcall output ceilings, not tool visibility.

## Architecture

### 1. Deterministic execution profile

Compile the user turn into an execution profile before any expensive preparation. The profile is not another model call. It decides whether the turn needs architect planning, memory retrieval, thread summarization, MCP discovery, repository retrieval, documents, artifact validation, status chatter, or normal tool exposure.

The existing `TurnBudget` remains the resource envelope. A new execution-profile layer owns *which preparation stages run*, while `tool-registry.ts` remains the authority over which model-visible tools are relevant.

### 2. Trivial fast path

For a trivial general turn with no files and no artifact/audio/image request:

- skip architect consultation;
- skip MCP metadata/tool construction;
- skip repository retrieval;
- skip document extraction;
- skip artifact/council/critique machinery;
- skip broad durable-memory and learned-skill reads unless the utterance explicitly refers to remembered context;
- expose no model tools unless the request explicitly asks for a capability;
- suppress progress/status stages that add latency before useful text;
- use the existing trivial output/step envelope.

This must be a real execution shortcut, not only a smaller token limit.

### 3. Selective context and capabilities

Add deterministic predicates for context needs: memory/history, environment, repository/deployment, web/research, connectors, code execution, artifacts, and self-update. Only the relevant preparation blocks and tool groups are built. Do not add a second blind numeric cap after the relevance-aware registry.

Model-visible tools stay coarse and useful. New "MLM" intelligence should primarily be deterministic middleware: intent normalization, context gating, payload compression, artifact preflight, structural validation, answer-length checks, and completion repair. These modules must not become dozens of extra JSON schemas sent on every turn.

### 4. Artifact quality pipeline

Artifact work follows:

`request compiler -> minimal relevant context -> generation -> deterministic structural audit -> optional one-pass targeted repair -> final output`

The structural audit should detect at minimum:

- empty or stub output;
- obvious truncation/incomplete ending;
- unbalanced HTML/JSX/CSS delimiters where cheaply detectable;
- missing expected artifact body after an artifact header;
- broken script/style termination;
- suspicious fixed-width/mobile overflow patterns in generated UI artifacts;
- payloads that exceed the artifact transport/storage limits.

A failure may trigger one targeted repair prompt containing the defect summary and the smallest necessary artifact excerpt/context. It must not automatically regenerate the whole artifact multiple times.

### 5. Length-stop behavior

When a provider finishes with a length ceiling:

- if deterministic completion checks say the answer/artifact is already usable, keep it;
- if only a small tail is missing, permit one small continuation/repair call within the subcall envelope;
- otherwise surface a truthful continuation state instead of silently restarting a large request.

### 6. Natural streaming

Remove the fixed 26 ms word-by-word `smoothStream` transform from ordinary text responses. Prefer provider-native streaming. If fragment coalescing is needed for the UI, buffer only tiny character-level fragments and flush immediately on natural boundaries; do not introduce an artificial per-word delay.

The bubble layout remains NaviOS-specific and compact. This change concerns cadence, not the visual chat structure.

### 7. Status messaging

Normal conversational replies should not emit a sequence of "Preparing... / Planning... / Drafting..." messages before text. Status stages remain for work where they explain real latency: repository retrieval, research, long code tasks, artifact generation, image/audio generation, or multi-step tool execution.

### 8. Zero-dollar safety

The existing zero-dollar firewall remains authoritative. No new fast path, repair path, or continuation path may bypass provider eligibility checks or enable a paid model merely because free capacity is constrained.

## Affected boundaries

Primary files expected to change:

- `app/api/chat/route.ts` — execution staging, fast path, streaming transform removal, status gating, artifact/length integration.
- `lib/ai/navi-soul/turn-budget.ts` — boundary correctness for subcall output room; no return value may exceed provider room.
- `lib/ai/tool-registry.ts` — only if needed to expose deterministic relevance predicates cleanly; registry remains tool-visibility owner.
- a focused new deterministic execution-profile module under `lib/ai/navi-soul/`.
- artifact quality/repair helpers under the existing artifact/Navi Soul area, following current repo patterns.
- focused tests under `tests/` for fast-path preparation, streaming contract, artifact repair, and output-boundary behavior.

## Acceptance criteria

1. A trivial greeting has no MCP construction, repository retrieval, document extraction, council/critique pass, or unrelated model-visible tools.
2. A repository request still receives repository tools; a research request still receives research tools; a memory request still receives memory/history capability.
3. Ordinary text streaming no longer contains the fixed 26 ms word-by-word smoother.
4. Artifact structural defects trigger no more than one targeted repair pass.
5. `subcallOutputBudget(..., providerRoom)` never returns a value greater than `providerRoom`, including provider rooms below 128 tokens.
6. Zero-dollar routing protections remain unchanged or stronger.
7. Typecheck, full test suite, production build, dependency audit, and Vercel preview all pass before merge.
8. PR remains unmerged until fresh verification evidence is collected for the final head SHA.

## Non-goals

- Replacing Navi Soul with another model.
- Adding many new model-visible tools simply to make the system appear more agentic.
- Rebuilding the mobile UI in this change.
- Introducing a paid fallback.
- Rewriting the entire chat route into a new framework in one PR.

## Verification strategy

Use red-green-refactor tests for each behavioral change. After implementation, run the repository's full CI pipeline and production build, inspect the final PR diff for security/performance regressions, verify the exact Vercel preview deployment, and exercise representative trivial, standard, repository/research, and artifact flows where the connected runtime permits it. If a browser connector is unavailable, do not substitute claims of visual runtime verification; report that limitation explicitly.
