# Connecting Gmail and Calendar

The code is done. This is the Google Cloud side, and it has one trap in it that
is worth reading before you start.

---

## Use a second Google Cloud project. Not the sign-in one.

Sign-in uses `email` and `profile` — **non-sensitive** scopes, no review, which
is why publishing that consent screen was free and instant.

Gmail is different. `gmail.readonly` is a **restricted** scope, and
`gmail.compose`, `calendar.readonly` and `calendar.events` are **sensitive**
ones. The rule that matters:

| Consent screen state | What restricted scopes cost |
|---|---|
| **Testing** | Nothing. Up to 100 test users, no review. One "Google hasn't verified this app" screen you click past |
| **Published** | Verification, plus an annual third-party CASA security assessment for restricted scopes. That one is not free |

Publishing status is a property of the **project**, not of an individual OAuth
client. So if you add Gmail scopes to the project whose consent screen you
already published for sign-in, you push that project into needing verification —
and sign-in is riding on it.

**So: a second project, left in Testing, with your own address as a test user.**
Sign-in stays published in the first one and is unaffected. For a personal
deployment this is the end state, not a workaround — Testing mode has no expiry
for the grant and no user cap you will reach.

---

## Setup

**1. New project** in Google Cloud Console, signed in as the account whose mail
you want read.

**2. Enable the APIs.** *APIs & Services → Library* → enable **Gmail API** and
**Google Calendar API**. Missing this produces a 403 at the first tool call, not
at consent, so it looks like a permissions bug rather than a setup step.

**3. OAuth consent screen** → **External**. Fill in the app name and support
emails. **Leave it in Testing.** Under *Test users*, add your own address —
without this you cannot authorize at all.

**4. Credentials** → *Create credentials → OAuth client ID → **Web
application***. Authorized redirect URI, exactly:

```
https://navikeep.org/api/google/oauth/callback
```

**5. Vercel** — add to the navisonnet project and redeploy:

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | From step 4 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From step 4 |
| `NAVI_GOOGLE_ALLOW_WRITES` | `true` — **only** if you want sending and calendar writes. Omit for read-only |

**6. In the app** — Settings → Capabilities → Connectors → Google → **Connect**.

---

## What you get

Read-only, which is the default:

- **`gmail_search`** — Gmail's own query syntax (`from:`, `newer_than:7d`, `is:unread`)
- **`gmail_read`** — one message in full
- **`gmail_draft`** — saves a draft, sends nothing
- **`calendar_list_events`** — what is coming up

Drafting sits on the read side deliberately. A draft is reversible and stays
inside the account, and "write me an email" almost always means draft — so the
useful half of composing survives without granting send.

With `NAVI_GOOGLE_ALLOW_WRITES=true`:

- **`gmail_send`** — sends immediately, cannot be undone
- **`calendar_create_event`**

Turning that switch on changes the scopes requested, so **everyone has to
reconnect**. Until they do, the connection keeps its old narrower grant, and the
new tools fail at the moment they are used. `/api/google/status` reports the
scopes Google says the grant actually has rather than the ones the deployment
asked for, so the Connectors row tells the truth about this.

---

## Where the credential lives

The refresh token goes in an httpOnly cookie, exactly as the GitHub token does.
Page JavaScript cannot read it; only server code on this origin can. Each
request trades it for a one-hour access token and discards that.

No database is involved, deliberately — conversations already live only on the
device, and adding a server-side token store for this would change what the app
promises about where a person's data sits.

Disconnecting in Connectors deletes the cookie. That stops this deployment
using the grant but does not revoke it at Google; to do that, remove NaviOS
under your Google account's third-party access.

---

## If it fails

| Symptom | Cause |
|---|---|
| "did not return a lasting credential" | Google withheld the refresh token because this account authorized before. Remove NaviOS from your Google account's third-party access, then connect again |
| `redirect_uri_mismatch` | The URI in step 4 is not byte-identical to the callback |
| `access_denied`, or your address is not listed | The consent screen is in Testing and you are not a test user |
| A tool says the connection "does not cover that" | The grant predates a scope change. Reconnect |
| 403 on the first tool call, consent having worked | The Gmail or Calendar API is not enabled on the project (step 2) |
