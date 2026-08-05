import "server-only";

/**
 * Authentication is intentionally opt-in: local previews and deployments
 * without a publishable key plus Clerk's public JWT verification key continue
 * to run without an account wall during local development.
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

/**
 * Which credentials are missing, for the server log. A deployment with only one
 * of the two silently falls back to no sign-in at all, which looks like the app
 * losing its Google button rather than like a configuration problem — so say
 * which half is absent instead of leaving it to be guessed.
 */
export function describeClerkConfigGap(): string | null {
  const missing = [
    getClerkPublishableKey() ? null : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (must start with pk_)",
    getClerkJwtKey() ? null : "CLERK_JWT_KEY (the PEM public key from Clerk's JWKS settings)"
  ].filter(Boolean);
  if (!missing.length) return null;
  if (missing.length === 2) return "Clerk is not configured; sign-in is disabled. Missing: " + missing.join(" and ") + ".";
  return "Clerk is only half configured, so sign-in is disabled entirely. Missing: " + missing.join("") + ".";
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

/**
 * The one origin sign-in is allowed to happen on, or nothing.
 *
 * The redirect exists so a Clerk session issued on the canonical domain is not
 * split across several hostnames that all serve the same deployment. That is
 * right in production and wrong everywhere else: a preview deployment is served
 * from its own generated hostname, and sending that hostname to production
 * makes the preview unreachable — so no change can be looked at before it
 * merges, which is exactly backwards. The build being previewed is the one
 * nobody has verified yet; it is the build most in need of being opened.
 *
 * Absent `VERCEL_ENV` this is a local or self-hosted run, where the configured
 * origin is honoured as before.
 */
export function getNaviAuthCanonicalOrigin(): string | undefined {
  const deployment = process.env.VERCEL_ENV;
  if (deployment && deployment !== "production") return undefined;
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
    "https://navikeep.org",
    "https://www.navikeep.org",
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
 * When an allowlist is supplied, access is restricted to those Clerk users.
 * Otherwise any user authenticated by the configured Clerk instance may enter.
 *
 * This deliberately does not fail closed on an empty allowlist: doing so locked
 * the owner out of their own deployment with no way back in.
 */
export function isClerkUserAllowed(userId: string): boolean {
  const allowed = getAllowedClerkUserIds();
  return allowed.length === 0 || allowed.includes(userId);
}
