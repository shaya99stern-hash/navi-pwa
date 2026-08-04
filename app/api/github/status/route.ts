import { NextResponse } from "next/server";

import {
  GITHUB_TOKEN_COOKIE,
  githubOAuthConfigured,
  githubWritesEnabled,
  readGithubToken
} from "@/lib/github/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** What Settings needs to render the GitHub row without guessing. */
export async function GET() {
  const token = await readGithubToken();
  const base = {
    oauthAvailable: githubOAuthConfigured(),
    writesEnabled: githubWritesEnabled()
  };

  if (!token) return NextResponse.json({ ...base, connected: false, login: null, scopes: [] });

  const probe = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "NaviOS-Hub",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    cache: "no-store"
  });

  if (!probe.ok) {
    // An expired or revoked token is a disconnected state, not an error page.
    return NextResponse.json({ ...base, connected: false, login: null, scopes: [] });
  }

  const user = (await probe.json()) as { login?: string };
  const scopes = (probe.headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return NextResponse.json({ ...base, connected: true, login: user.login ?? null, scopes });
}

export function DELETE() {
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(GITHUB_TOKEN_COOKIE);
  return response;
}
