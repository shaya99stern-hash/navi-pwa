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
export function getClerkAuthorizedParties(): string[] {
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

  return Array.from(new Set([
    "https://navisonnet.vercel.app",
    "https://navisonnet.navikeep.org",
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
 * Production fails closed when Clerk is enabled without an owner allowlist.
 * Local development remains convenient while credentials are being configured.
 */
export function isClerkUserAllowed(userId: string): boolean {
  const allowed = getAllowedClerkUserIds();
  if (allowed.length === 0) return process.env.NODE_ENV !== "production";
  return allowed.includes(userId);
}
