# Cosmetic audit

Every user-facing control, traced to the code that runs when it changes.

**Verdicts.** `real` — it does what it says. `partial` — it does something, but
less or other than the copy claims. `cosmetic` — it changes state nothing reads.
`dev-facing` — it works, but its audience is not the person holding the phone.

**Method.** Static trace from each control's handler to its effect, plus three
executed measurements (the SKILL.md corpus, the haptic call-site census, the
skill-executor coverage count). Nothing here was verified on a physical iPhone;
items that require one are marked `needs-device` and collected in
`docs/device-checklist.md`. Where this audit says `real`, it means the code path
exists and is reached — not that it has been felt on a device.

---

## Composer

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|Composer|`+` menu|Add photos, camera, files|Opens a sheet driving three real `<input type=file>` elements; dedupes, enforces `MAX_ATTACHMENTS` and `ATTACHMENT_BUDGET`|`real`|
|Composer|Effort pill|Change effort|Opens `EffortSheet`; `preferences.effort` ships in `requestBody` (`app-shell.tsx:370`)|`real`|
|Composer|Research toggle|Search the web for this message|`toggleResearch` sets `tools.web`; `tools` ships in `requestBody` (`app-shell.tsx:371`)|`real`|
|Composer|Mic|Record a message|Records via `MediaRecorder`, uploads to `/api/voice/transcribe`, appends the transcript. **Was `partial`** — see Phase 1 below|`real` (fixed)|
|Composer|Voice mode|Spoken conversation|Opens `VoiceModeSheet`, which drives the same recorder and speaks the reply|`real`|
|Composer|Send / Stop|Send, or stop generating|`sendMessage` / `stop` from `useChat`|`real`|
|Composer|Starter chips|Seed a first message|Writes the draft and refocuses; "Visualize " is phrasing the server's image-intent matcher recognises|`real`|
|Composer|Slash suggestions|On-device commands|`suggest()` over 82 skills, all with registered executors; runs with no provider call|`real`|

## Settings → General

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|General|Full name / Display name / Work / Instructions|Carried into every chat|Ship as `userContext` in `requestBody` (`app-shell.tsx:385`)|`real`|
|General|Appearance|System / Light / Dark|Sets the theme and persists a cookie for first paint|`real`|
|General|Chat font|Serif or system|`chatFont` reaches `MessageRow`, which applies `.navi-chat-serif`|`real`|
|General|**Motion**|"Reduce animation in streaming responses and other interface elements."|**Wrote `document.documentElement.dataset.motion` and no CSS rule read it.** The only reduced-motion rules keyed off `prefers-reduced-motion`, which is the OS setting, not this switch. Moving it changed an attribute and shortened nothing|**`cosmetic`** → fixed|
|General|Density|Comfortable / Compact|Sets `.density-compact`, which `globals.css:595` reads|`real`|
|General|**Haptics**|"Subtle touch feedback on selection, success, and errors."|Gesture-time ticks fired; **result-time ticks — the "success" and "error" cases named in the copy — were skipped**, because activation expires across an await|**`partial`** → fixed|
|General|Voice language|Dictation language|Sent as `?language=` to the transcribe route, forwarded to the API as a bare subtag|`real`|
|General|Response completions|Notify when a response finishes|Requests permission, posts a Notification when hidden (`app-shell.tsx:307`)|`real`|

## Settings → Memory and storage

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|Privacy|Local history|Keep chats on this device|Gates the IndexedDB write|`real`|
|Privacy|Memory|Draw on earlier chats|Gates `recall()`; matched on-device, only used passages sent|`real`|
|Privacy|**"What is stored" counters**|Conversations / Facts / Skills / Lessons|**Counted the Supabase mirror only.** With no Supabase, or signed out, every counter read `0` while the drawer beside it listed real conversations|**`partial`** → fixed|
|Privacy|Forget a fact|Immediate and irreversible|`DELETE /api/memory/facts`|`real`|
|Privacy|Export data|Download JSON|Serialises chats, projects, preferences|`real`|

## Settings → Playbooks

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|Playbooks|Paste a SKILL.md|"any skill published for Claude can be pasted in below and **works here unchanged**"|Parses frontmatter and body. Measured against 35 published SKILL.md files: **35/35 parsed, 22/35 had the body silently cut at 4,000 chars** (`pptx` kept 20%), 9/35 had the description cut at 400. Files shipping `scripts/` or `REFERENCE.md` cannot bring them at all|**`partial`** → copy narrowed, truncation now reported|

## Connectors

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|Connectors|`Test`|Verify this credential works|Real outbound call per provider — model-list for adapters, a live search for Tavily/Exa, key-in-query for Gemini. Reports the real status|`real`|
|Connectors|`Replace` / provision|Store a key|`POST /api/connectors/provision`, writes through the Vercel API|`real`|
|Connectors|Access mode|Ask / auto-reads / always|Ships as `connectorAccessMode` in `requestBody`|`real`|
|Connectors|**"Set `MCP_SERVER_REGISTRY_JSON` in Vercel and redeploy"**|—|Accurate, and unusable by anyone reading it on a phone|**`dev-facing`** → moved to Settings → Developer|
|Connectors|**"Configured … with `NAVI_VERCEL_TOKEN`"**, GitHub/Google `setup`, `unlockWrites`|—|Same|**`dev-facing`** → moved|

## Drawer

|Screen|Control|What it claims|What it actually does|Verdict|
|---|---|---|---|---|
|Drawer|New chat|Start a chat|Real. Duplicated by the header compose icon — see 4.2|`real`|
|Drawer|Search|Find a conversation|Searches every message body, not just titles, and returns a ranked snippet|`real`|
|Drawer|Pin / Rename / Delete|—|All write through to storage|`real`|
|Drawer|**"Update NaviOS · NaviOS is up to date"**|Check for an update|Genuinely checks. But it is build management in primary navigation, reporting "nothing to do" on every open, and Settings → Account → App already has it|**`real` but misplaced** → now appears only when an update is actually waiting|

---

## Phase 1 — the microphone

One sentence: **the audio was being recorded correctly the whole time; the level
meter was dead, because its `AudioContext` was constructed after `await
getUserMedia` — and on iOS a context built outside user activation is born
`suspended` and never runs.**

The analyser read a flat 128 forever, so `inputLevel` stayed `0`, so every
waveform bar computed to its 3px floor. The composer drew a motionless row of
dots for the entire recording. From the outside that is indistinguishable from a
microphone that is not listening, which is exactly how it was reported.

Fix: construct the context before the await, inside the activation the tap
granted (`lib/ui/recorder.ts:159`), and `resume()` it if it still arrives
suspended.

Two further defects found behind it:

- **`stop()` could hang forever.** It awaited an `onstop` that only fires for a
  running recorder. iOS moves a recorder to `inactive` on its own whenever the
  audio session is interrupted — a call, Siri, another app taking the mic — and
  the promise then had nothing left to resolve it. The composer sat at
  "Transcribing…" indefinitely, with no error. (`recorder.ts:255`)
- **`MAX_AUDIO_BYTES` was 8 MB**, above the ~4.5 MB request body Vercel accepts
  (4 MB on the edge runtime), enforced at the platform edge before the handler
  runs. So the route's own 413 could never render. Now 3.5 MB on both sides,
  with a 60-second recording cap and a visible countdown.

### Where this brief was wrong

- *"Two minutes of iPhone `audio/mp4` will exceed 8 MB."* No. Speech records at
  32–128 kbps, so two minutes is roughly 0.5–2 MB. The body limit is a real
  latent bug — a long recording fails opaquely — but it was **not** the cause of
  everyday dictation failing. The suspended `AudioContext` was.
- *"Roughly forty haptic calls fire after an await."* Measured: **122 call
  sites, 25 classified result-time**, and several of those were false positives
  of the heuristic. The defect is real; the count was about double.
- *"`isTypeSupported` may be lying about the container."* Possible, still
  unproven. `describeRecordingSupport()` now logs the full matrix on first
  record so the next failure leaves evidence instead of a shrug.

### Not verified here

- **1.2, the standalone getUserMedia matrix.** Four cells, all `needs-device`.
  The recorder now detects standalone and gives different, correct advice there
  (an installed iOS app has no per-site permission pane to send anyone to).
- **1.4, the Hugging Face response shape.** `needs-device`. Egress to
  `router.huggingface.co` is blocked from this environment (`CONNECT tunnel
  failed, 403`) and no `HF_TOKEN` is present, so no live request could be made.
  This remains exactly as unverified as `docs/open-items.md` says.

## Phase 3 — feel

- **3.1 haptics** — every result-time tick moved onto its gesture, or dropped
  where a visual already reports the outcome. The Settings description will need
  a second look once this is felt on a device; it currently still promises
  "success and errors", and what now happens is a tick on the *tap* that starts
  those operations.
- **3.2 edge swipe** — `setPointerCapture` added. **`touch-action: pan-y` was
  deliberately not added.** The brief assumed a dedicated 26px strip; the
  handlers are actually on the whole app shell (`app-shell.tsx:1045`), so that
  rule would kill horizontal scrolling in code blocks and the attachment
  carousel. Capture alone fixes the reported freeze.
- **3.3 Safari back-gesture conflict** — `needs-device`, untested.
- **3.4 windowing** — `content-visibility: auto` on finished rows only. The
  streaming row opts out: giving a growing element a guessed intrinsic height is
  what makes scroll anchoring jump.

## Phase 7 — measured before proposing

|Measure|Value|
|---|---|
|Skills declared|82|
|With a registered executor|**82 / 82**|
|Resolve with no provider call (via `/slash`)|**82 / 82 (100%)**|
|Resolve from ordinary prose, no slash, no round trip|**3 / 82 (3.7%)**|
|Executor modules|7|

**This inverts the plan.** The brief targets a 500-skill library; the measurement
says executor coverage is already 100% and the bottleneck is entirely *routing
from natural language*. `lib/skills/instant.ts` recognises three shapes —
arithmetic, unit conversion, today's date. The other 79 skills work perfectly
and are reachable only by someone who already knows the slash command exists.

Adding 418 more skills would not remove a single provider call. Widening the
prose matcher over the 79 that already exist would. That is the first move, and
it is much cheaper than the one proposed.

`npm run eval` could not be run: it drives a live server with provider
credentials, which this environment has neither of. `needs-device`.

## Phase 5 — GitHub write path

- `write-guards.ts` — **49 assertions passing** in `tests/write-guards.test.ts`.
  The guards fire in test. Whether they hold against a live token is
  `needs-device`.
- OAuth chain end to end — `needs-device`. Note `docs/open-items.md` is right
  that Clerk's GitHub sign-in connection and the repository-access OAuth app
  must be **separate apps**; one OAuth app holds one callback URL.
- Inline code editing in chat — **not built, as instructed.** What is missing:
  a diff-rendering message part, a per-hunk accept/reject control, and a way to
  hold a proposed patch in conversation state until it is accepted. The commit
  path underneath it already exists.

## Deliberately not done

- **4.1, one voice surface.** The brief says collapse mic, waveform button and
  voice sheet into one. The answer to 4.3 was "whatever the iOS reference client
  does" — and that client ships *both* a dictation mic and a separate voice-mode
  entry. Applying the owner's own stated principle argues for keeping both, so
  the surfaces are left as they are pending an explicit call. Overrule this and
  it is a small change.
- **4.2, two ways to start a chat.** Same reasoning: header compose icon and
  drawer "New chat" both exist in the reference client. Kept, deliberately.
- **4.4, settings density.** Not regrouped. General still holds profile,
  appearance, font, motion, density, haptics, voice and notifications in one
  scroll.
- **Phase 6, parity capture.** Requires screen recordings of the reference app,
  which only the owner can produce. No parity numbers have been invented here;
  `docs/parity-spec.md` is deliberately not written rather than filled with
  values recalled from training, which would be exactly the failure 6.1 warns
  about.
