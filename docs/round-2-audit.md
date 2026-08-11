# Round 2 — navigation, projects, keys, identity, mic

Sources: the running app, the code at `c5db222`, and the exported chat history
(6 conversations, 110 messages). The export is the most useful evidence in the
repository right now — most of what follows was diagnosed from it rather than
from a bug report.

---

## Fixed in this pass

### 1. Every long answer was being cut off — the worst bug in the app

`MAX_OUTPUT_TOKENS = 1_900`. About 1,400 words.

The export shows what that does, in the user's own words, inside a single
conversation: *"Why do you keep stopping"* · *"Continue where you left off"* ·
*"Continue from where you stopped"* · *"Continue where u left off"* · *"What is
timing you out?"*

The model was never stopping. It was cut mid-sentence, then asked to resume an
answer whose ending it could not see — which is why the continuations repeated
themselves, re-numbered sections, and drifted. It also answered *"I'm not timing
out—I'm delivering the full upgrade plan in a single, structured response"*,
which was a confabulation: it had no way to know it had been truncated.

**Fixed:** 8,000 tokens.

This one change will alter the app's character more than anything else in this
document.

### 2. It did not know which repository it lives in

Asked directly, it said the source repo *"is not `navi-pwa`"*, that it *"cannot
name it directly here"*, and described navi-pwa as a *"public wrapper for the
Navi Claude artifact"*. All invented.

Not a lie and not a tool failure: **nothing in the prompt ever named the repo**,
while `commit_own_source` gave it every reason to believe one existed.
`app/api/commit/route.ts` has known the answer all along
(`shaya99stern-hash/navi-pwa`) and never told the model.

**Fixed:** `selfRepoKnowledge()` reads the same environment the commit route
reads, so the answer and the action cannot disagree.

### 3. Settings → Developer bounced back to the chat

`onClose()` unwinds the sheet's history entry; that unwind is async and lands
*after* `router.push`, cancelling it. The drawer was fixed for exactly this bug;
the settings sheet never got the same fix.

**Fixed**, with a test that pins the ordering.

### 4. It did not know you own it

Nothing in the prompt said so, so it hedged and explained to you what it was
"not allowed" to do in your own product.

**Fixed:** an owner block, when the signed-in account passes the same allowlist
check the API uses. This settles **standing, not accuracy** — no guard is
loosened, destructive actions still confirm, and the rule against claiming
something worked when it did not still outranks everything.

### 5. A microphone self-test

Settings → Voice → **Test microphone**. Runs the real pipeline and names the
first step that fails: browser support → permission → track state → audio-context
state → **measured signal** → encoding → the network round trip with its real
HTTP status.

The signal check is the one that matters for your report. A recorder can produce
a perfectly valid file of silence, and from the outside that is indistinguishable
from a recorder that never started.

---

## The microphone — where I actually stand

You reported two symptoms together: **flat waveform while speaking**, and
**failure on send**. I have now diagnosed this from source twice and been
partly wrong twice — first the audio container, then the suspended
`AudioContext`. Both were real defects. Neither was the whole story.

So I am not going to guess a third time. The two candidates the test will
separate:

- **Silent capture.** The stream opens, the file has bytes, but the audio is
  silence — so the waveform is flat *and* transcription returns nothing. On iOS
  this happens when another audio session holds the mic. Note this app calls
  `speechSynthesis` (read-aloud, voice mode); if speech output has the session,
  capture goes silent. **I consider this the leading candidate**, because it is
  the only single cause that produces both your symptoms at once.
- **A 401 on the transcribe route.** `/api/voice/transcribe` requires a signed-in
  Clerk session. Signed out, every transcription fails with "Sign in to
  continue." That produces symptom two but not symptom one.

**What I need from you:** run Test microphone once and send me the rows. That
turns three rounds of guessing into a named cause.

---

## Not yet fixed — findings and my recommendations

### 6. `learn_skill` is broken, and it is the most-repeated frustration in the export

Across two conversations: *"You save all of it"* → *"Did you save all this?"* →
*"I want you to save it not me"* → *"I need you to add everything and learn
directly here and update and upgrade your brain from what I feed you"* → *"Ok
are you now smarter? Is it saved to your brain?"*

Every attempt failed. Navi Soul then told you it *"cannot permanently upgrade or
rewire my own brain"* — which is **false**: `learn_skill` exists and is wired to
a real table.

**I was wrong about the cause, and I have now checked instead of guessing.**

With access to the live project (`NaviOS Project`, `nrackqbpziexpywhdrku`):

- `list_migrations` shows `20260807065118 navi_cloud_memory` **applied**.
- `list_tables` shows `navi_chats`, `navi_preferences`, `navi_learned_skills`
  all present, RLS enabled, 0 rows.
- The security advisor flags exactly one table for having RLS with no policies,
  and it is `navios_memory` — an orphan not referenced anywhere in this
  codebase. The three tables the app uses are **not** flagged, which means their
  policies exist.

So schema, policies, and migration are all fine. My "the migration was never
applied" hypothesis — repeated confidently several times — was wrong.

**What is left is the JWT.** Every policy is `user_id = auth.jwt() ->> 'sub'`.
If Supabase cannot verify the Clerk token, `auth.jwt()` yields null, every
policy compares against null, and every read and write is refused — which from
the app looks identical to a missing table. That fits the evidence exactly: the
tables exist and have never held a single row.

**The fix is not SQL.** Clerk has to be registered as a third-party auth
provider in the Supabase project (Authentication → Sign In / Providers → Third
Party Auth), so Supabase validates Clerk's JWTs against Clerk's JWKS. Until
then no amount of migrating changes anything.

I could not verify the auth configuration or apply changes myself: read-only
Supabase calls are permitted in this session, but `execute_sql` and
`apply_migration` require interactive approval that a background session cannot
obtain. The error message now names this case outright, so one attempt from the
app will confirm it.

**Recommendation, in order:**
1. Add Clerk as a third-party auth provider in the Supabase project. This is
   the actual fix, and it also restores chat sync and custom-connector key
   durability, which fail for the same reason.
2. **Done.** The failure is legible: the real PostgREST status and body now
   reach the model and the API, and 401/403 is named as the JWT-trust case
   rather than left as a status code.
3. Still open: a "Teach Navi Soul" row in Settings → Skills that writes
   directly and shows the server's answer, so teaching does not depend on the
   model getting a tool call right.

**Also worth cleaning up:** `navios_memory` has RLS enabled, no policies, and no
references anywhere in the code — an orphan from an earlier iteration that is
unreadable by anyone. Dropping it is a destructive change, so it is yours to
make, not mine.

### 7. Projects are a stub

Your export tells the whole story: one project, `{"name": "New project",
"instructions": "", "knowledge": []}`, and **not one chat has a `projectId`**.

**Correction to an earlier draft of this document.** Two claims here were
wrong, and both made the feature sound more broken than it is: project
`knowledge[]` *is* used — it ships in `requestBody` and the server renders it
into the prompt — and filing a chat into a project *does* exist, as "Move to
project" in the chat menu. Both are now pinned by tests so the corrections
cannot drift back.

The real gaps were narrower, and they are exactly the two the owner named:

- `createProject()` immediately made a project called "New project" with no
  naming step, so the instructions field that gives a project its entire
  purpose stayed empty. **Fixed:** creation opens a form asking for a name
  (required) and instructions (optional), and creating also selects the project
  for the current conversation.
- Projects never appeared in the sidebar; they lived behind a sheet, so a
  project was something you made once and never saw again. **Fixed:** a
  Projects section in the drawer with a conversation count on each row, hidden
  while searching so it cannot push results off screen.

**A third correction.** Starting a chat while a project is active *does*
already file it there — the persist path stamps the active project onto the
chat. That is now pinned by a test too.

Three wrong claims in one section is worth naming as a pattern rather than
three slips: I read the projects code for what was missing and found what I
expected to find. The plumbing was almost entirely present; what was absent was
any way to *reach* it. Diagnosing "unreachable" as "unbuilt" would have meant
rewriting working code, which is the more expensive mistake.

Still open on projects:

- `knowledge[]` is text notes only. Attaching real files to a project — upload
  once, every chat in it can draw on them — is its own piece of work.
- A chat with no project can be adopted by whichever project was last active,
  because the stamp is applied on every save rather than only at creation. Low
  harm, but it is why a chat can appear in a project you did not put it in.

### 8. Navigation — you are right, and here is the actual rule

Today the sidebar carries: mode switch, New chat, Chats, Projects, Artifacts,
**Customize**, update, account. Settings separately carries General, Account,
Memory, Capabilities, Skills, Playbooks, Connectors, Developer. "Customize" is
a third thing that is really a shortcut into Settings — which is why it reads as
meaningless.

**Fixed.** The rule applied: *the sidebar is things you have; Settings is things
you configure.*

The sidebar is now New chat · Chats · Projects · Artifacts, in both modes.
Code mode used to swap Projects out for Developer and "Connectors and keys" —
configuration surfaces displacing the user's own content, which is exactly the
"why is all this stuff in this side panel" complaint. Customize is gone; a menu
whose only job is to shortcut into another menu is redundancy by definition.
Both destinations remain in Settings, and Settings → Developer now opens
instead of bouncing back, so nothing became unreachable.

The original reasoning, kept because it is the rule to apply to the next row
somebody wants to add:

- **Sidebar:** New chat · Chats · Projects · Artifacts. Nothing else. That is
  your content.
- **Settings:** everything else, Developer included.
- **Delete "Customize" entirely.** Skills, Playbooks and Connectors are
  configuration; they belong in Settings and are already there. A menu whose
  only job is to shortcut into another menu is the definition of redundancy.
- **The mode switch stays** at the top of the sidebar — it is a durable choice
  about what you are working in, and it is genuinely the first question.

### 9. API keys — your concern is right and the answer you were given was wrong

Navi Soul told you keys live in Vercel's encrypted environment variables and
survive reinstall. **That is true for one of the two paths and false for the
other**, and the app never distinguishes them:

- **Catalog providers** (Groq, Gemini, HF…) added via Connectors → `POST
  /api/connectors/provision` → written to Vercel. These **do** survive. ✓
- **Custom connectors** (your own OpenAI-compatible endpoint, Supabase, MCP)
  are stored in `preferences.customConnectors`, which lives in IndexedDB. On
  reinstall, **they are gone** unless you are signed in with cloud memory
  working — and cloud memory is the thing that appears to be broken (§6).

**Partly fixed.** The screen now states where the keys actually are, checked
rather than promised: "synced to your private account memory, so they survive
reinstalling" when the mirror is running, and a warning that they are in this
browser only — and will be lost on reinstall — when it is not.

**Still open, and it is worth knowing why.** You asked for "add it here, it
goes to Vercel automatically". For the catalog providers that already happens.
For custom connectors it cannot use the same path: provisioning writes a *named*
environment variable from the catalog, and a connector you define yourself has
no such name — making one up per connector would invent a naming scheme that
then has to be migrated forever.

The natural durable home for them is the preferences mirror, which already
syncs to your account. That is blocked on the same Supabase migration as
§6. **So applying that migration fixes key durability and `learn_skill`
together** — which moves it from "worth doing" to the single highest-value
action available.

Worth saying plainly: this is the second time the app has confidently told you
something reassuring and wrong about your own data. The pattern — not the
individual answer — is what to fix.

### 10. Developer settings — I agree, and I would delete the screen

You said you do not like the layout and do not see why it is separate. I think
you are right, and the reason is structural: **it is a worse version of what
Code mode already does.** A path box, a textarea, and a commit button is a
text editor on a phone. Code mode can already read, edit, and commit — that is
the interface you actually want.

**Recommendation:**
- Keep, in Settings → Developer: the deployment-variable reference, engine
  capabilities, and update. Reference material.
- Delete the file editor. Anything it can do, "change X and commit it" does
  better.
- Put the work in Code mode instead: show a real diff in the conversation before
  committing, with Approve / Reject. That is the piece genuinely missing, and it
  is what makes "tell it what to do and it pushes" trustworthy rather than
  alarming.

### 11. Smaller things from the export

- **YouTube transcripts fail.** You asked four times to learn from a video. It
  cannot fetch transcripts; it should say so once, in one sentence, not
  three paragraphs of alternatives each time.
- **Artifacts silently exceeded a size limit.** **Fixed.** The cap is 180 KB and
  the model was never told it existed — so it generated a large document, had it
  rejected with no error it could read, invented an explanation, and retried at
  the same size. The chat history has that loop three attempts deep on the
  chat-history export. The budget is now stated in the artifact instruction,
  with the instruction to narrow or split *before* emitting. A limit nobody is
  told about is a trap rather than a limit.
- **"Stop writing in code"** — you said it explicitly. Heavy bold/headers/code
  fences on every answer is a prompt default worth changing; the reference iOS
  client writes prose by default and reserves structure for when it helps.
- **Stale self-knowledge.** Asked where "Update the app" went, it invented an
  answer and blamed a missing `NAVI_GITHUB_TOKEN`. It is in Settings → Account →
  App. Same root cause as §2: it guesses about itself instead of being told.

---

## Order I would take it

1. **Apply the Supabase migration** (§6) — likely unblocks all of memory and
   teaching, and costs one command.
2. **Run Test microphone** (§5) and send me the rows.
3. **Projects** (§7) — the biggest felt gap.
4. **Navigation rule** (§8) — delete Customize, move Developer into Settings only.
5. **Key provenance** (§9).
6. **Diff-in-chat for Code mode** (§10), then delete the file editor.

Items 1 and 2 are yours and take minutes. Everything else I can build.
