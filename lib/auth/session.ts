import "server-only";

import { verifyToken } from "@clerk/backend";

import { getClerkAuthorizedParties, getClerkJwtKey } from "./config";

export const CLERK_SESSION_COOKIE_NAME = "__session";

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
  requestOrigin?: string
): Promise<string | null> {
  const jwtKey = getClerkJwtKey();
  if (!token || !jwtKey) return null;

  try {
    const payload = await verifyToken(token, {
      jwtKey,
      authorizedParties: getClerkAuthorizedParties(requestOrigin)
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

export async function getRequestClerkUserId(request: Request): Promise<string | null> {
  let origin: string | undefined;
  try {
    origin = new URL(request.url).origin;
  } catch {
    origin = undefined;
  }
  return verifyClerkSessionToken(getRequestClerkSessionToken(request), origin);
}
