import { cookies } from "next/headers";
import { readCredential } from "@/lib/ai/credentials";

/**
 * GitHub OAuth for a PWA that has no server of its own beyond the Vercel Route
 * Handlers already shipping the app.
 *
 * The web flow is used rather than the device flow because GitHub's device
 * endpoints send no CORS headers, so a browser cannot complete that exchange at
 * all. The web flow needs a client secret, which must never reach the client.
 * Both constraints land in the same place: a Route Handler on the deployment
 * that already serves the app. No local bridge, no localhost, nothing new to
 * run — this is the same origin the PWA is installed from.
 *
 * The resulting token is stored in an httpOnly cookie, so JavaScript in the
 * page can never read it; only server code on this origin can.
 */

export const GITHUB_TOKEN_COOKIE = "navi.gh.token.v1";
export const GITHUB_STATE_COOKIE = "navi.gh.state.v1";

/** Reading is the default. `repo` is requested only when writes are enabled. */
export const GITHUB_SCOPES_READ = "read:user repo:status public_repo";
export const GITHUB_SCOPES_WRITE = "read:user repo";

export function githubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID?.trim() && process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

/**
 * Writes stay off unless the install opts in. A model editing a repository from
 * a phone on its own judgement is a different product with a different risk
 * profile, so this is a deliberate, separate switch.
 */
export function githubWritesEnabled(): boolean {
  return process.env.NAVI_GITHUB_ALLOW_WRITES === "true";
}

/** The callback must be byte-identical between authorize and exchange. */
export function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/github/oauth/callback`;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", githubWritesEnabled() ? GITHUB_SCOPES_WRITE : GITHUB_SCOPES_READ);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID?.trim(),
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim(),
      code,
      redirect_uri: redirectUri
    }),
    cache: "no-store"
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { access_token?: string; error?: string };
  return payload.access_token?.trim() || null;
}

/**
 * The signed-in user's own token wins; the install-wide PAT is the fallback so
 * existing single-user deployments keep working with no configuration change.
 */
export async function readGithubToken(): Promise<string | undefined> {
  const jar = await cookies();
  const userToken = jar.get(GITHUB_TOKEN_COOKIE)?.value?.trim();
  if (userToken) return userToken;
  /* The install-wide token, resolved from the one list every other module
     reads. This used to accept its own three names and miss `GITHUB_PAT` —
     the name the Settings screen offers first — so a deployment configured
     the way the app advises had no repository tools while reporting GitHub as
     connected. */
  return readCredential("github");
}
