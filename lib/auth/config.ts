import "server-only";

/**
 * Authentication is intentionally opt-in: local previews and deployments
 * without a publishable key plus Clerk's public JWT verification key continue
 * to run without an account wall.
 */
export function getClerkPublishableKey() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  return key?.startsWith("pk_") ? key : undefined;
}

export function getClerkJwtKey() {
  const key = process.env.CLERK_JWT_KEY?.trim();
  return key?.includes("BEGIN PUBLIC KEY") ? key : undefined;
}

export function isClerkConfigured() {
  return Boolean(getClerkPublishableKey() && getClerkJwtKey());
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function getNaviAuthCanonicalOrigin(): string | undefined {
  return normalizeOrigin(process.env.NAVI_AUTH_CANONICAL_ORIGIN?.trim());
}

/**
 * Clerk's `azp` claim is checked against exact trusted origins to prevent a
 * session cookie leaked by another subdomain from being accepted by Navi.
 */
export function getClerkAuthorizedParties(requestOrigin?: string): string[] {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()));
  const vercelOrigins = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ].map(normalizeOrigin);
  const localOrigins = process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:3000", "http://localhost:3100", "http://127.0.0.1:3000", "http://127.0.0.1:3100"];

  /* The origin this request was actually served from is always authorized:
     only domains attached to this deployment can route here, and omitting it
     locks users out of every custom domain that is not hard-coded below. */
  return Array.from(new Set([
    normalizeOrigin(requestOrigin),
    "https://navisonnet.vercel.app",
    ...configured,
    ...vercelOrigins,
    ...localOrigins
  ].filter((value): value is string => Boolean(value))));
}

export function getAllowedClerkUserIds(): string[] {
  return (process.env.NAVI_ALLOWED_CLERK_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("user_"));
}

export function hasClerkUserAllowlist(): boolean {
  return getAllowedClerkUserIds().length > 0;
}

/**
 * The Clerk sign-in itself is the access gate; the allowlist is an optional
 * extra restriction. With no allowlist configured every signed-in account gets
 * its own workspace, since stored state is scoped per Clerk user id. Setting
 * NAVI_ALLOWED_CLERK_USER_IDS narrows access to those accounts only.
 *
 * This deliberately does not fail closed on an empty allowlist: doing so locked
 * the owner out of their own deployment with no way back in.
 */
export function isClerkUserAllowed(userId: string): boolean {
  const allowed = getAllowedClerkUserIds();
  return allowed.length === 0 || allowed.includes(userId);
}
