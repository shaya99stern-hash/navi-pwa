# Setup handoff — the parts that need a browser and an account

Everything in this document requires signing into a third-party dashboard, so
it could not be done from the build environment. The code side is finished and
green; this is the configuration that turns it on.

Paste the prompt at the bottom into an agent that has browser access, or work
through the steps yourself.

---

## What the app is

NaviOS — a Next.js PWA on Vercel, deployed at **navikeep.org**, project
**navisonnet**. Sign-in is Clerk. The assistant is called Navi Soul.

---

## 1. Google sign-in through Clerk

### The thing most likely to be wrong

**A Clerk production instance cannot use Google without your own Google Cloud
OAuth credentials.** Development instances (`*.clerk.accounts.dev`) get Clerk's
shared preconfigured credentials, so Google works there with a single toggle.
Production instances do not. If Google works in development and not on
navikeep.org, this is why — not the app.

It is free. Creating an OAuth client for basic sign-in needs no billing account
and no paid tier; the `email` and `profile` scopes are non-sensitive and need no
Google verification review.

### Order matters

Clerk gives you a redirect URI; Google needs it before it will issue
credentials; Clerk then needs the credentials back. So:

**1. In Clerk** — open the **production** instance for navikeep.org. Find the
social connections screen (currently *Configure → SSO Connections*, but Clerk
moves this; look for where OAuth providers are added). Add **Google**. Turn on
**custom credentials**. Copy the **Authorized Redirect URI** it shows.

**2. In Google Cloud Console** — pick or create a project.

- *APIs & Services → OAuth consent screen*: choose **External**. Fill in the app
  name, a user support email, and a developer contact email.
- **Publish the app.** This is the step people miss. While it is in *Testing*,
  only accounts explicitly listed as test users can sign in — everyone else gets
  an error that looks like a broken integration.
- *APIs & Services → Credentials → Create credentials → OAuth client ID →
  **Web application***.
- Paste Clerk's redirect URI into **Authorized redirect URIs**. It must match
  exactly, including scheme and any trailing path.
- Copy the **Client ID** and **Client Secret**.

**3. Back in Clerk** — paste both, save.

### Then verify

Open `https://navikeep.org/sign-in` and use the Google button. If it fails,
**open the browser console first** — the failure modes look identical on screen
but are completely different underneath:

| What the console says | What it means |
|---|---|
| A Content-Security-Policy violation | An origin is missing from the policy. The app derives these from the publishable key, so this means the key in Vercel does not match the instance you configured |
| `redirect_uri_mismatch` | The URI in Google does not exactly match the one Clerk issued |
| `access_denied` or an "app not verified" screen | The consent screen is still in *Testing* — publish it |
| Nothing at all, button does nothing | Clerk is half-configured; see §2 |

---

## 2. Clerk environment variables — a silent failure worth knowing about

`lib/auth/config.ts` requires **both**:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — must start with `pk_`
- `CLERK_JWT_KEY` — the PEM public key from Clerk's JWKS settings

With only one set, sign-in is disabled **entirely and silently**. The sign-in
page renders "Sign-in is unavailable on this deployment", which reads exactly
like a broken Google button. The deployment logs name which half is missing.

### Check the environment scoping in Vercel

If these are scoped to **Production only**, then preview deployments have no
authentication at all — which is a separate confusing symptom: the preview URL
either lets everyone in, or (before a fix shipped in this branch) redirected to
production. Decide deliberately whether previews should have auth, and scope
accordingly.

---

## 3. Everything else that is waiting on a key

| Variable | What it turns on | Notes |
|---|---|---|
| `TAVILY_API_KEY` | Web search | 1,000 calls/month free. Results are cached for an hour and the tool disables itself at 90% of the allowance |
| `DEEPSEEK_API_KEY` | The one paid model lane | New accounts get 5M free tokens, no card |
| `NAVI_MONTHLY_BUDGET_USD` | Spend ceiling for that lane | Defaults to `10` |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Makes the spend cap enforceable across serverless instances | Adding Vercel KV or Upstash from the Vercel integrations page sets both automatically. **Without a durable store the paid lane stays off**, because a per-instance counter cannot enforce a cap |
| `NAVI_ALLOW_UNMETERED_SPEND=true` | Runs the paid lane without that store | Only if you accept an unenforced ceiling — reasonable while spending the free tokens |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | Per-user GitHub sign-in | Callback: `https://navikeep.org/api/github/oauth/callback` |
| `NAVI_GITHUB_ALLOW_WRITES=true` | Branch, commit, and pull-request tools | Flipping it forces users to re-authorize, because the scope changes |

**Do not add `BRAVE_SEARCH_API_KEY`.** Brave's perpetual free tier ended in
February 2026; a new account gets a one-time credit and a card on file with no
spend cap. The provider was removed from the code for that reason.

---

## 4. Checks that need a physical iPhone

Install the app to the home screen from Safari. Desktop Chrome does not count —
the things being tested are iOS-specific.

- [ ] Remove the primary provider key in Vercel, redeploy, send a message. A
      normal answer should arrive with no error card and no provider name
      anywhere on screen. It should silently use another lane.
- [ ] Ask for a code sample. The block should render syntax-highlighted with a
      working copy button.
- [ ] Read three responses aloud. If any contains "I think", "I believe", "it
      seems", "essentially", or "it's important to note", the system prompt is
      not doing its job.
- [ ] Tap into the composer. The page must not zoom, and the header must not
      slide away.

---

## 5. Things shipped but never run against the real thing

Each of these is written and tested, but the build environment could not reach
the service to prove it end to end.

- **Python execution** — ask Navi Soul to write and run a Python function.
- **PDF reading** — attach a PDF and ask about its contents. It should quote
  the text rather than describe the page.
- **Repository retrieval** — in Code mode, ask about a repo by `owner/name`.
  It should say which files it read.
- **Free-model discovery** — the catalogue's field names were never checked
  against a live response, because `openrouter.ai` is unreachable from the
  build environment. It is default-deny, so a wrong guess means fewer models
  rather than a wrong one, but it is unconfirmed.

---

## The prompt

Paste this into an agent with browser access:

> I need you to finish configuring a deployed web app. The code is done; this is
> all dashboard work. The app is **NaviOS**, a Next.js PWA on Vercel, project
> **navisonnet**, live at **navikeep.org**. Sign-in is Clerk.
>
> **Task 1 — Google sign-in.** Google works on Clerk development instances with
> a toggle, but a **production** instance requires my own Google Cloud OAuth
> credentials. Set that up:
>
> 1. In the Clerk dashboard, open the production instance for navikeep.org, add
>    the Google social connection, enable custom credentials, and copy the
>    Authorized Redirect URI it gives you.
> 2. In Google Cloud Console, create or select a project. Configure the OAuth
>    consent screen as **External**, fill in the app name and support emails, and
>    **publish it** — while it is in Testing only listed test users can sign in,
>    which looks like a broken integration. Then create an OAuth client ID of
>    type **Web application** and paste Clerk's redirect URI into Authorized
>    redirect URIs, matching it exactly.
> 3. Put the resulting Client ID and Client Secret back into Clerk and save.
>
> This should cost nothing — basic sign-in uses the non-sensitive `email` and
> `profile` scopes, which need no billing account and no verification review.
> Tell me if anything asks for payment rather than proceeding.
>
> **Task 2 — check the Clerk environment variables in Vercel.** The app needs
> **both** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_`) and
> `CLERK_JWT_KEY` (a PEM public key from Clerk's JWKS settings). With only one,
> sign-in is disabled entirely and silently, which looks exactly like a broken
> Google button. Confirm both are present, and tell me which Vercel
> environments they are scoped to — if they are Production-only, preview
> deployments have no authentication.
>
> **Task 3 — verify.** Open `https://navikeep.org/sign-in` and try the Google
> button. If it fails, open the browser console and tell me exactly what it
> says. These look identical on screen and mean different things: a
> Content-Security-Policy violation means the publishable key in Vercel does not
> match the instance that was configured; `redirect_uri_mismatch` means the URI
> in Google does not match Clerk's; an "app not verified" screen means the
> consent screen was never published.
>
> Do not change any application code — the repository is mid-review on a pull
> request. Report what you changed in each dashboard and anything you could not
> complete.
