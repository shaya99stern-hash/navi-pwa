import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_TOKEN_COOKIE,
  exchangeGoogleCode,
  googleCallbackUrl,
  googleOAuthConfigured
} from "@/lib/google/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  /* Every failure lands back in Settings with a reason in the query string, so
     the user sees a sentence in the app rather than a blank JSON page. */
  const fail = (reason: string) => NextResponse.redirect(`${origin}/settings?google=${reason}`);

  if (!googleOAuthConfigured()) return fail("unconfigured");
  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(GOOGLE_STATE_COOKIE)?.value;
  // CSRF: the state returned by Google must be the one this browser was issued.
  if (!code || !state || !expected || state !== expected) return fail("state");

  const refresh = await exchangeGoogleCode(code, googleCallbackUrl(request));
  /* No refresh token is its own failure, distinct from a rejected exchange:
     Google omits it when the user has authorized before and the request did not
     force the consent screen. The connection would appear to succeed and then
     stop working within the hour. */
  if (!refresh) return fail("norefresh");

  const response = NextResponse.redirect(`${origin}/settings?google=connected`);
  response.cookies.set(GOOGLE_TOKEN_COOKIE, refresh, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180
  });
  response.cookies.delete(GOOGLE_STATE_COOKIE);
  return response;
}
