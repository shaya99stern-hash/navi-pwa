Set up Google sign-in for a deployed app, end to end. Do the work — do not
diagnose first, the problem is known.

## Context

- App: **NaviOS**, a Next.js PWA. Vercel project **navisonnet**, production
  domain **navikeep.org**. Auth is **Clerk**.
- Google account to use for everything: **shaya99stern@gmail.com**
- Do not change application code. The repository is mid-review on a pull
  request. All of this is dashboard and environment-variable work.

## 1. Google Cloud Console — build a new project

Sign in as shaya99stern@gmail.com and create a **new** project. Do not reuse an
existing one.

- *OAuth consent screen*: **External**. App name `NaviOS`, user support email
  and developer contact both shaya99stern@gmail.com.
- **Publish the app.** Do not leave it in Testing — in Testing only explicitly
  listed test users can sign in, and everyone else gets an error that looks
  like a broken integration.
- *Credentials → Create credentials → OAuth client ID → **Web application***,
  name it `NaviOS Production`.
- You will need Clerk's redirect URI first — get it in step 2, then come back
  and paste it into **Authorized redirect URIs**. It must match exactly.

This costs nothing. Basic sign-in uses the non-sensitive `email` and `profile`
scopes, which need no billing account and no verification review. If anything
asks for payment, stop and tell me instead of proceeding.

## 2. Clerk — add Google to the production instance

Open the Clerk dashboard, **production** instance for navikeep.org.

- Add the **Google** social connection.
- Enable **custom credentials** — a production instance cannot use Clerk's
  shared development credentials, which is why this has not been working.
- Copy the **Authorized Redirect URI** Clerk shows, paste it into the Google
  OAuth client from step 1, then paste Google's **Client ID** and **Client
  Secret** back into Clerk. Save.

If you create or rotate anything in Clerk that changes its keys, note the new
**publishable key**, **secret key**, and **JWT public key (PEM)** — you will
need them in step 3.

## 3. Vercel — clean up, then set

The environment variables are currently a mess and must be tidied as part of
this, not left alongside the new ones.

**Delete the duplicates.** These three each appear **three times** in the
navisonnet project:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_KEY`
- `CLERK_AUTHORIZED_PARTIES`

Keep exactly one of each, holding the values for the Clerk instance you
configured in step 2. Delete every other copy, including any scoped to an
environment you are not using. Stale duplicates are why sign-in behaves
differently between production and preview.

**Then confirm these are correct and present:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From the Clerk instance in step 2. Starts with `pk_` |
| `CLERK_SECRET_KEY` | From the same instance |
| `CLERK_JWT_KEY` | The PEM public key from that instance's JWKS settings |
| `CLERK_AUTHORIZED_PARTIES` | `https://navikeep.org,https://www.navikeep.org` |
| `NAVI_AUTH_CANONICAL_ORIGIN` | `https://navikeep.org` |

The publishable key and the JWT key must come from the **same** Clerk instance.
Mismatched ones fail in a way that looks like a broken button rather than a
configuration error. If only one of the two is set, the app disables sign-in
entirely and silently.

Decide the scoping deliberately: if you want preview deployments to require
sign-in, scope all Clerk variables to **Production, Preview, and Development**.
If you want previews open, scope them to Production only.

**Redeploy** after the changes — environment variables do not take effect until
the next deployment.

## 4. Verify

Open `https://navikeep.org/sign-in`. A **Google** button should appear beside
the email field; right now only email shows. Sign in with
shaya99stern@gmail.com and confirm it completes.

If it fails, open the browser console and report the exact error. These look
identical on screen and mean different things:

- a **Content-Security-Policy** violation → the publishable key in Vercel does
  not match the Clerk instance you configured
- **`redirect_uri_mismatch`** → the URI in Google does not exactly match
  Clerk's
- an **"app not verified"** screen → the consent screen was never published

## Report back

- The Google Cloud project name and OAuth client name you created
- Which Vercel variables you deleted and which you kept, with their scoping
- Whether Google sign-in completed, and any console error if not
