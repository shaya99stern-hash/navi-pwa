# Open items

Everything shipped and verified is in the git history. This is the list of what
is *not* closed, and who has to close it. Kept in the repository because the
build environment is ephemeral and a list held only in a conversation is a list
that gets lost.

Last updated after handoff Task 14 and the Task 11 removals.

---

## Needs a physical device — Gate A

Three of Gate A's four checks cannot be run from a build environment. The grep
check passes and is asserted in `tests/phase-a.test.ts`.

- [ ] Kill the primary provider key. Send a message. The answer should arrive
      normally, with no error and no provider name.
- [ ] Ask for a code sample. The block should render highlighted with a working
      copy button.
- [ ] Read three responses aloud. Any hedge phrase from A1 means the prompt is
      not done. The banned phrases are listed in `lib/ai/prompt/base.ts` and
      each is asserted by name.

Run on an iPhone with the app installed to the home screen. Desktop Chrome does
not count.

---

## Needs credentials, or a run

Shipped but never exercised against the real thing.

| What | Why it is unproven | How to prove it |
|---|---|---|
| Python execution | Needs Vercel credentials and a reachable sandbox API; neither exists in the build environment | Ask NaviSol to write and run a Python function |
| Preview sign-in | The proxy here blocks both the preview URL and production, so the fix could not be loaded | Open the preview URL and see whether it loads or redirects |
| Free-model discovery | `openrouter.ai` is unreachable from the build environment, so the catalogue's field names were never checked against the live response | One request to `/api/v1/models` and a look at the JSON |
| DeepSeek quality lane | No key configured | Set `DEEPSEEK_API_KEY` |
| Web search | No key configured | Set `TAVILY_API_KEY` |
| PDF extraction | `unpdf` verified against its own exports, but no real PDF was run through it here | Attach a PDF and ask about its contents |
| Repository retrieval | Needs a connected GitHub account and a real repository | Ask about a repo by `owner/name` in Code mode |

Discovery is default-deny and the sandbox fails closed, so being wrong about
either costs a degraded answer rather than a bill. But neither is *confirmed*.

---

## Environment variables

| Variable | Effect | Required? |
|---|---|---|
| `TAVILY_API_KEY` | Web search | For research |
| `DEEPSEEK_API_KEY` | The metered quality lane | Optional |
| `NAVI_MONTHLY_BUDGET_USD` | Spend ceiling, defaults to `10` | With DeepSeek |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Makes the spend cap enforceable across instances. Vercel KV or Upstash sets these automatically | To make the cap real |
| `NAVI_ALLOW_UNMETERED_SPEND=true` | Runs the paid lane *without* a durable ledger | Only if you accept an unenforced ceiling |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | Per-user GitHub sign-in. Callback: `https://navikeep.org/api/github/oauth/callback` | For repository work |
| `NAVI_GITHUB_ALLOW_WRITES=true` | Branch, commit, and pull-request tools. Flipping it forces re-auth | For writes |

Note: `BRAVE_SEARCH_API_KEY` is **retired**. Brave's perpetual free tier ended
in February 2026 and a new account gets a card on file with no spend cap, so
the provider was removed rather than deprecated. Do not add one.

---

## Blocked on a decision, not on work

### Parity 3.5 Phases C and D

Both are specified on Supabase. This app has no database and no server-side
storage of user data at all — conversations live in IndexedDB on the device,
which is a stated product property rather than an accident.

- **Phase C (MCP client)** wants a server registry table for connector
  configuration and encrypted tokens.
- **Phase D (memory)** wants a profile store and full-text search across past
  conversations, which is also handoff Task 12.

Adding Supabase is a new service, a new dependency, and a change to what the
app promises about where a person's data lives. That is a product decision, not
a build task. Some of Phase D could be done on-device instead — full-text
search across local conversations needs no server — and that would be a
different, smaller piece of work.

### Handoff tasks not yet finished

| Task | State |
|---|---|
| 8 — Context compaction | Partly done. `lib/ai/compaction.ts` exists and is used; the `prepareStep` hook the spec names is not wired |
| 10 — One voice mode | Not started. Flagged three times as possibly larger than it reads; worth scoping before committing to it |
| 11 — Remove redundancy | Deletions done. The engine picker and "Run quality check" still live in Settings; the spec moves them to a hidden diagnostics page behind a five-tap gesture on the version string, which is a new surface rather than a removal |
| 17 — Settings two-pane at ≥768px | Not started |

Task 12 is absorbed by Phase D. Tasks 15 and 16 overlap Phase B and Phase C.

Done: 1, 2, 3, 4, 5, 6, 7, 9, 13, 14, 18, and Parity 3.5 Phases A and B.

---

## Known gaps recorded elsewhere

`docs/version-2-backlog.md` holds work that was deliberately not done, with the
reasoning: image generation, Python in the browser sandbox, and the third-party
model names still living in the swarm guardrails.
