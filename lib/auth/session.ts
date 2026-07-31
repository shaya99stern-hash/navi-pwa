import "server-only";

import { verifyToken } from "@clerk/backend";

import { getClerkAuthorizedParties, getClerkJwtKey } from "./config";

export const CLERK_SESSION_COOKIE_NAME = "__session";
/** Clerk's own marker for "this browser holds a live client session". */
export const CLERK_CLIENT_UAT_COOKIE_NAME = "__client_uat";

/**
 * How far past `exp` a signature-valid session token may still identify its
 * user.
 *
 * Clerk mints 60-second session tokens and refreshes them from the browser
 * while a tab is open, so an installed PWA launched from the home screen
 * always arrives carrying an expired one. Rejecting it outright signs the user
 * out on every cold launch — and because the layout derives the storage scope
 * from the same result, it also rewrites that scope to `signed-out`, which
 * clears the shell caches and reads history under the wrong key. The app looks
 * broken and empty, not merely logged out.
 *
 * Clerk's own middleware avoids this by handshaking with its Frontend API to
 * mint a fresh token, which requires a secret key this deployment deliberately
 * does not hold. Honouring a still-valid signature briefly past `exp` is the
 * equivalent available to a deployment holding only the public JWT key.
 */
const STALE_SESSION_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

export type ClerkSessionState =
  /** Token verified within its own lifetime. */
  | "active"
  /** Signature and audience are valid; only `exp` has passed. */
  | "stale"
  | "none";

export type ClerkSession = { userId: string | null; state: ClerkSessionState };

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}

export async function verifyClerkSessionToken(
  token: string | undefined,
  requestOrigin?: string,
  clockSkewInMs?: number
): Promise<string | null> {
  const jwtKey = getClerkJwtKey();
  if (!token || !jwtKey) return null;

  try {
    const payload = await verifyToken(token, {
      jwtKey,
      authorizedParties: getClerkAuthorizedParties(requestOrigin),
      ...(clockSkewInMs === undefined ? {} : { clockSkewInMs })
    });
    return typeof payload.sub === "string" && payload.sub.startsWith("user_")
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export function getRequestClerkSessionToken(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), CLERK_SESSION_COOKIE_NAME);
}

/**
 * Clerk writes the epoch seconds of the last client update here and resets it
 * to 0 on sign-out, so a signed-out browser never reaches the grace path and
 * signing out stays immediate.
 */
function hasLiveClerkClient(clientUat: string | undefined): boolean {
  if (!clientUat) return false;
  const updatedAt = Number.parseInt(clientUat, 10);
  return Number.isFinite(updatedAt) && updatedAt > 0;
}

export async function resolveClerkSession(
  token: string | undefined,
  clientUat: string | undefined,
  requestOrigin?: string
): Promise<ClerkSession> {
  const active = await verifyClerkSessionToken(token, requestOrigin);
  if (active) return { userId: active, state: "active" };
  if (!token || !hasLiveClerkClient(clientUat)) return { userId: null, state: "none" };

  // Only `exp` is relaxed. A forged, tampered or wrongly-audienced token still
  // fails here, and one whose browser has signed out never gets this far.
  const stale = await verifyClerkSessionToken(token, requestOrigin, STALE_SESSION_GRACE_MS);
  return stale ? { userId: stale, state: "stale" } : { userId: null, state: "none" };
}

export async function resolveRequestClerkSession(request: Request): Promise<ClerkSession> {
  const cookieHeader = request.headers.get("cookie");
  let origin: string | undefined;
  try {
    origin = new URL(request.url).origin;
  } catch {
    origin = undefined;
  }
  return resolveClerkSession(
    readCookie(cookieHeader, CLERK_SESSION_COOKIE_NAME),
    readCookie(cookieHeader, CLERK_CLIENT_UAT_COOKIE_NAME),
    origin
  );
}

export async function getRequestClerkUserId(request: Request): Promise<string | null> {
  return (await resolveRequestClerkSession(request)).userId;
}
