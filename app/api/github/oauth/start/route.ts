import { NextResponse } from "next/server";

import { GITHUB_STATE_COOKIE, buildAuthorizeUrl, callbackUrl, githubOAuthConfigured } from "@/lib/github/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!githubOAuthConfigured()) {
    return NextResponse.json(
      {
        error: "GitHub sign-in is not configured.",
        fix: "Add GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET in Vercel, then redeploy."
      },
      { status: 501 }
    );
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildAuthorizeUrl(state, callbackUrl(request)));
  /* Ten minutes is longer than any real sign-in and short enough that a stale
     tab cannot be replayed against a later attempt. */
  response.cookies.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });
  return response;
}
