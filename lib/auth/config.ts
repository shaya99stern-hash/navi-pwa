import "server-only";

/**
 * Authentication is intentionally opt-in: local previews and deployments
 * without a publishable key plus a server verification key continue to run
 * without an account wall.
 */
export function getClerkPublishableKey() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  return key?.startsWith("pk_") ? key : undefined;
}

export function getClerkSecretKey() {
  const key = process.env.CLERK_SECRET_KEY?.trim();
  return key?.startsWith("sk_") ? key : undefined;
}

export function getClerkJwtKey() {
  const key = process.env.CLERK_JWT_KEY?.trim();
  return key?.includes("BEGIN PUBLIC KEY") ? key : undefined;
}

export function isClerkConfigured() {
  return Boolean(getClerkPublishableKey() && (getClerkSecretKey() || getClerkJwtKey()));
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
