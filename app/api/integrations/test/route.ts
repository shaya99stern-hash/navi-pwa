import { githubToken, vercelToken } from "@/lib/ai/dev-tools";
import { authorizeApiMutation } from "@/lib/auth/api";

/**
 * Actually call the integration and report what came back.
 *
 * The Integrations sheet could previously only say whether an environment
 * variable was non-empty. A token that is expired, revoked, mistyped, or
 * scoped to the wrong repositories looks identical to a working one under that
 * test — which makes "Connected" a claim the app cannot support.
 *
 * This makes the smallest real request each API offers and reports the
 * identity it answers with, so "connected" means a specific account
 * answered rather than a string existing.
 */
export const runtime = "edge";

const TIMEOUT_MS = 8_000;

export type IntegrationTest = {
  ok: boolean;
  /** Who the token belongs to, when the call succeeded. */
  identity?: string;
  /** What went wrong, in terms of the action to take. */
  error?: string;
};

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testGitHub(): Promise<IntegrationTest> {
  const token = githubToken();
  if (!token) return { ok: false, error: "No token set. Add NAVI_GITHUB_TOKEN in Vercel, then redeploy." };
  try {
    const response = await fetchWithTimeout("https://api.github.com/user", {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "NaviOSHub/1.0"
    });
    /* These two are the failures that actually happen, and they need
       different actions — one is a new token, the other is more scopes. */
    if (response.status === 401) return { ok: false, error: "The token was rejected. It is expired, revoked, or mistyped — create a new one." };
    if (response.status === 403) return { ok: false, error: "The token is valid but lacks permission, or the rate limit is exhausted." };
    if (!response.ok) return { ok: false, error: `GitHub returned ${response.status}.` };
    const data = await response.json() as { login?: string };
    if (!data.login) return { ok: false, error: "GitHub answered without an account." };
    return { ok: true, identity: data.login };
  } catch {
    return { ok: false, error: "Could not reach GitHub." };
  }
}

async function testVercel(): Promise<IntegrationTest> {
  const token = vercelToken();
  if (!token) return { ok: false, error: "No token set. Add NAVI_VERCEL_TOKEN in Vercel, then redeploy." };
  try {
    const response = await fetchWithTimeout("https://api.vercel.com/v2/user", {
      Authorization: `Bearer ${token}`
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "The token was rejected. It is expired, revoked, or scoped to another team." };
    }
    if (!response.ok) return { ok: false, error: `Vercel returned ${response.status}.` };
    const data = await response.json() as { user?: { username?: string; email?: string } };
    const identity = data.user?.username || data.user?.email;
    if (!identity) return { ok: false, error: "Vercel answered without an account." };
    return { ok: true, identity };
  } catch {
    return { ok: false, error: "Could not reach Vercel." };
  }
}

export async function POST(request: Request): Promise<Response> {
  /* Each call spends a little of the owner's rate limit and reveals which
     account a token belongs to, so it needs the same authorization as any
     other mutation rather than being an open probe. */
  const authorizationError = await authorizeApiMutation(request);
  if (authorizationError) return authorizationError;

  const target = new URL(request.url).searchParams.get("target");
  if (target !== "github" && target !== "vercel") {
    return Response.json({ ok: false, error: "Unknown integration." }, { status: 400 });
  }

  const result = target === "github" ? await testGitHub() : await testVercel();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
