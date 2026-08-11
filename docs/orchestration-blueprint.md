# Navi Soul — orchestration blueprint

What the controller does today, what it does not, and the exact design for the
gap. Every claim here is traceable to a file; where something does not exist,
it says so rather than describing it as though it did.

**A note on the framing.** "1000x intelligence" is not a quantity anything here
can deliver, and pretending otherwise would make this document useless. What an
orchestrator can do is spend the right model on the right sub-problem, notice
when an answer is wrong, and try again — which is worth a great deal and is not
the same thing. The honest ceiling is set by the best model in the pool; the
architecture decides how often you reach it.

---

## 1. The cognitive framework

### What exists

`lib/ai/architect.ts` — a two-tier planner.

| Tier | Function | Cost | When |
|---|---|---|---|
| Heuristic | `heuristicPlan` | free, synchronous | always |
| Model | `architectPlan` | one round trip | `shouldConsultArchitect` says so |

Both produce an `ExecutionPlan`:

```ts
{ lane, summary, constraints: string[], steps: string[], needsReview: boolean }
```

`constraints` is the load-bearing field. It travels into the answering prompt
via `constraintBlock`, and again into the reviewer as the checklist the draft is
judged against. That is what makes verification more than "read it again": the
reviewer has a written standard that was fixed *before* the answer existed.

### The gap

**Failure points are never named.** The plan says what to do and what to
satisfy. Nothing says what is most likely to go wrong, so the reviewer has to
rediscover it from scratch on every request.

### The design

Add one field:

```ts
risks: Array<{ what: string; check: string }>
```

The planner already reasons about the request; asking it for the two or three
things most likely to be wrong costs no extra round trip. Each risk carries its
own check, and those checks are prepended to the reviewer's list. A reviewer
told *"the off-by-one in the pagination boundary is the likely defect"* finds it
far more reliably than one told *"look for errors"*.

Bound it at three. A risk list long enough to cover everything is a list the
reviewer skims.

---

## 2. The routing matrix

### What exists

Two functions in `lib/ai/providers.ts`:

- `selectLane` — difficulty → lane (1–4)
- `routeForLane` — lane → provider

```
hasFiles          → 2   (multimodal)
longContext       → 4   (whole-repository reads)
effort high       → 3
code + complex    → 3, code otherwise → 4
effort low        → 1
else complex ? 3 : 2
```

Plus, since the frontier work: lane 3 escalates through OpenRouter to
`NAVI_FRONTIER_MODEL` when the ledger allows.

### The gap, stated precisely

**The matrix routes by *difficulty*, not by *kind of work*.** Lane 3 is "this is
hard" and sends everything hard to the same place. But hard-and-mathematical,
hard-and-long, and hard-and-fast-turnaround want different machines, and the
current table cannot express that.

There is one exception already conceded in the code — `tools.web || tools.code`
short-circuits to a tool-capable model regardless of lane, because capability
beats tier. That exception is the whole argument for the next table generalised.

### The design

A capability matrix consulted **before** the lane, in the same position the
tool-capability check occupies now.

| Work | Primary | Second | Why |
|---|---|---|---|
| Rapid formatting, extraction, classification | Groq | Cerebras | Tokens per second dominates; reasoning depth is irrelevant to reshaping text |
| Symbolic / mathematical | **on-device executor** | DeepSeek | 82 skills answer exactly with no model; a model is the wrong instrument for arithmetic |
| Code authoring, refactor | DeepSeek | Cerebras | Trained emphasis on code, and it is the metered lane already |
| Long-context synthesis, whole-repo | Gemini | Cerebras | Context window is the binding constraint, not cleverness |
| Multimodal | Gemini | HF Qwen-VL | Only routes that accept images |
| Intent parsing, routing decisions | Groq | Mistral | Must be fast — it is on the path of every request |
| Genuinely hard reasoning | frontier | DeepSeek | The only tier that raises the ceiling |

Two rules that matter more than the table:

1. **Never spend a model on something an executor answers exactly.** Arithmetic,
   unit conversion, hashing, date maths. This is already 28 prose routes deep
   (`lib/skills/instant.ts`) and is the cheapest intelligence in the system —
   correct by construction, zero latency, zero cost.
2. **Capability beats tier, always.** Attachments, tools, and context length are
   hard constraints. Difficulty is a preference. The current code already
   honours this for tools; the matrix must honour it for all three.

---

## 3. Multi-pass reflection — **built**

### What was wrong

`reviewDraft` ran exactly once. When it *revised*, that revision went to the
user unchecked.

That is a real hole, not a theoretical one: the single output nobody verified
was the one produced by the step whose entire job is verification. And a
correction is written under worse conditions than the original — more time
pressure, against a constraint list, by a model that still cannot run the code.
It is not obviously safer than what it replaced.

### The loop, as built

`reviewUntilSound` in `lib/ai/architect.ts`:

```
draft
  └─ round 1 → reviewer A
       ├─ PASS or SKIPPED  → ship
       └─ REVISED          → becomes the draft
            └─ round 2 → reviewer B     (different provider)
                 ├─ PASS/SKIPPED → ship
                 └─ REVISED      → ship (cap reached)
```

Four decisions worth defending:

- **Two rounds.** The third almost never changes the verdict, and a chain that
  keeps finding fault is usually two models disagreeing about taste rather than
  converging on correctness. The user waits through every round.
- **A different reviewer each round.** Asking the model that just wrote a
  correction to check that correction reproduces the exact blind spot the second
  opinion exists to break. It returns PASS on its own work.
- **The budget is shared, and a round that cannot finish is not started.** A
  review that times out mid-flight costs the wait and returns nothing.
- **Every failure keeps the best draft so far.** A verification step that cannot
  run is never a reason to withhold an answer.

### Still gated, deliberately

`critiqueAllowed` in `lib/ai/grounding.ts` runs this only when there is
something real to check against — retrieved files, or executed code. Asked to
"review your answer" with nothing to compare to, a model re-reads its own
reasoning, finds it agreeable because it wrote it, and returns a reworded
version at the cost of a full round trip. **That is worse than no pass**: it
spends the budget and adds a step where an error can enter.

The single highest-value change available to you here is not architectural —
it is turning on code execution (`tools.code`, currently `false` in your
exported preferences). It is what converts the review from opinion into
measurement.

---

## 4. Parallel decomposition

### What exists

`lib/ai/swarm.ts` (591 lines) and `lib/ai/swarm-router.ts` (340) — a council
with per-profile roles and model scoring.

### The gap

The plan carries `steps: string[]`, and **nothing executes them in parallel**.
They are shown and they inform the prompt. One model still answers the whole
request in one pass.

### The design

Fan out only when the sub-tasks are genuinely independent — which is rarer than
it looks, and the failure mode of getting it wrong is expensive.

```
plan.steps (2–4, independent)
  ├─ worker A ─┐
  ├─ worker B ─┤ parallel, per-step routing from §2
  └─ worker C ─┘
                └─ synthesiser (long-context model, sees all outputs
                   + the original request + the constraints)
                     └─ reviewUntilSound
```

Rules:

- **Decompose only on genuine independence.** If step B needs A's output, this
  is a pipeline, and running it in parallel produces two half-answers and a
  synthesiser inventing the join.
- **Cap at four.** Beyond that, synthesis cost exceeds the parallelism saved.
- **The synthesiser sees the original request**, not only the fragments —
  otherwise it reconciles worker outputs against each other rather than against
  what was asked.
- **A failed worker is a hole, not a failure.** Synthesise what returned and say
  which part is missing. A partial answer that names its gap beats an error.
- **Never fan out below the latency floor.** Three round trips plus synthesis
  costs more wall clock than one good model for anything under roughly a
  screenful of output.

Gate it on `plan.steps.length >= 2 && plan.lane !== "general"` and high effort.
Most requests should never take this path.

---

## 5. Operating instructions

The controller's own rules, in the order they bind. These are for the routing
layer, not prose for the answering prompt — the system prompt is deliberately
~1,200 tokens with a test enforcing that budget, because a long prompt degrades
instruction-following and is paid for on every turn.

1. **Answer without a model when a model is not needed.** 28 prose shapes and
   82 slash commands resolve exactly, offline, instantly. A model asked to do
   arithmetic is a worse calculator that costs money.
2. **Capability before tier.** Attachments, tools, and context length are hard
   constraints; difficulty is a preference. Never route to a model that cannot
   accept the input.
3. **Spend the frontier only on lane 3.** High effort or complex work. Anything
   else is buying reasoning for a request that did not ask a question.
4. **Verify only against something real.** Retrieval or execution. Self-review
   with no ground truth is a reworded answer at the cost of a round trip.
5. **Re-verify a correction.** The output of the verification step is not exempt
   from verification. Two rounds, different reviewer, shared budget.
6. **Degrade, never refuse.** Budget spent, provider down, review timed out —
   ship the best draft. Every ceiling in this system falls through to a working
   answer rather than an apology.
7. **Observe before asserting.** Every fabricated answer in this app's history
   came from a question about the running system with no way to look:
   which repository it lives in, why a skill would not save, where a setting
   went. `diagnose_self` is the standing fix, and the rule is that it is called
   before a capability is described, not after being contradicted.
8. **Report what happened, not what was attempted.** A rejected commit, a failed
   write, a skipped review — say so. The honesty rules outrank every other
   instruction here, including the owner's authority to direct the work.

---

## Implementation order

| | Change | Cost | Value |
|---|---|---|---|
| 1 | ~~Re-review corrections~~ | — | **built** |
| 2 | Turn on `tools.code` | a switch | high — converts review to measurement |
| 3 | Set `NAVI_FRONTIER_MODEL` | one variable | high — raises the ceiling |
| 4 | `risks[]` in the plan | small | high — directs the reviewer |
| 5 | Task-type matrix (§2) | medium | medium |
| 6 | Parallel decomposition (§4) | large | narrow — few requests qualify |

Items 2 and 3 are settings, not engineering, and outrank most of the
engineering below them. That is the least satisfying finding in this document
and the most useful one.
