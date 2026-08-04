import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GITHUB_STATE_COOKIE,
  GITHUB_TOKEN_COOKIE,
  callbackUrl,
  exchangeCode,
  githubOAuthConfigured
} from "@/lib/github/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  /* Every failure lands back in Settings with a reason in the query string, so
     the user sees a sentence in the app rather than a blank JSON page. */
  const fail = (reason: string) => NextResponse.redirect(`${origin}/settings?github=${reason}`);

  if (!githubOAuthConfigured()) return fail("unconfigured");
  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(GITHUB_STATE_COOKIE)?.value;
  // CSRF: the state returned by GitHub must be the one this browser was issued.
  if (!code || !state || !expected || state !== expected) return fail("state");

  const token = await exchangeCode(code, callbackUrl(request));
  if (!token) return fail("exchange");

  const response = NextResponse.redirect(`${origin}/settings?github=connected`);
  response.cookies.set(GITHUB_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90
  });
  response.cookies.delete(GITHUB_STATE_COOKIE);
  return response;
}
