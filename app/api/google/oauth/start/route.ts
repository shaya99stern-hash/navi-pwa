import { NextResponse } from "next/server";

import {
  GOOGLE_STATE_COOKIE,
  buildGoogleAuthorizeUrl,
  googleCallbackUrl,
  googleOAuthConfigured
} from "@/lib/google/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      {
        error: "Google is not configured on this deployment.",
        fix: "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel, then redeploy."
      },
      { status: 501 }
    );
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildGoogleAuthorizeUrl(state, googleCallbackUrl(request)));
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });
  return response;
}
