import { cookies } from "next/headers";

/**
 * Google OAuth for Gmail and Calendar, on the same terms as the GitHub
 * integration: a Route Handler on the origin already serving the app, a client
 * secret that never reaches the browser, and the resulting credential in an
 * httpOnly cookie that page JavaScript cannot read.
 *
 * What is stored is the *refresh* token, not an access token. Google's access
 * tokens last an hour, and a serverless deployment has nowhere to keep a
 * rotating value — so each request trades the refresh token for a fresh access
 * token and throws it away. That costs one extra round trip per tool call and
 * buys a connection that survives a cold start, which no in-memory cache here
 * can do.
 *
 * No database is involved, deliberately. Conversations already live only on the
 * device; adding a server-side token store for this would change what the app
 * promises about where a person's data sits.
 */

export const GOOGLE_TOKEN_COOKIE = "navi.google.refresh.v1";
export const GOOGLE_STATE_COOKIE = "navi.google.state.v1";

/**
 * Reading is the default, exactly as with repositories.
 *
 * `gmail.readonly` and `calendar.readonly` are enough to answer questions.
 * Composing is additive and gated: `gmail.compose` can create and send drafts,
 * `calendar.events` can write the calendar. Requesting them changes the consent
 * screen, so flipping the switch forces every user to re-authorize.
 */
export const GOOGLE_SCOPES_READ = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly"
].join(" ");

export const GOOGLE_SCOPES_WRITE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events"
].join(" ");

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
}

/**
 * Sending mail and writing a calendar are irreversible and leave the device, so
 * they are a separate, explicit decision — the same posture repository writes
 * take. Off by default even once an account is connected.
 */
export function googleWritesEnabled(): boolean {
  return process.env.NAVI_GOOGLE_ALLOW_WRITES === "true";
}

export function googleScopes(): string {
  return googleWritesEnabled() ? GOOGLE_SCOPES_WRITE : GOOGLE_SCOPES_READ;
}

/** The callback must be byte-identical between authorize and exchange. */
export function googleCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/google/oauth/callback`;
}

export function buildGoogleAuthorizeUrl(state: string, redirectUri: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleScopes());
  url.searchParams.set("state", state);
  /* Both are required to receive a refresh token at all. Without `offline` the
     grant dies in an hour; without `consent` Google silently omits the refresh
     token on every authorization after the first, which reads as the
     connection working once and then breaking for no reason. */
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store"
  });
  if (!response.ok) return null;
  return (await response.json()) as TokenResponse;
}

/** Exchanges the one-time code for a refresh token. Returns null on any failure. */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string | null> {
  const payload = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  return payload?.refresh_token?.trim() || null;
}

/**
 * Trades the stored refresh token for a usable access token.
 *
 * A null here means the connection is gone — revoked in the Google account,
 * expired through disuse, or invalidated by a scope change — not that the
 * request failed. Callers surface it as disconnected rather than as an error.
 */
export async function googleAccessToken(): Promise<string | null> {
  if (!googleOAuthConfigured()) return null;
  const jar = await cookies();
  const refresh = jar.get(GOOGLE_TOKEN_COOKIE)?.value?.trim();
  if (!refresh) return null;

  const payload = await tokenRequest({
    refresh_token: refresh,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
    grant_type: "refresh_token"
  });
  return payload?.access_token?.trim() || null;
}

export async function googleConnected(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(GOOGLE_TOKEN_COOKIE)?.value?.trim());
}

/**
 * RFC 2822 message, base64url encoded, which is the only shape Gmail's send and
 * draft endpoints accept.
 *
 * `btoa` is used over a Buffer so this stays usable on the edge runtime, and
 * the body goes through TextEncoder first so a non-ASCII subject or body does
 * not throw on the way in.
 */
export function encodeRfc822({ to, subject, body, cc }: { to: string; subject: string; body: string; cc?: string }): string {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    ""
  ].filter((line): line is string => line !== null);

  const message = `${headers.join("\r\n")}\r\n${body}`;
  const bytes = new TextEncoder().encode(message);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Gmail returns message bodies base64url encoded, sometimes split across parts. */
export function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
