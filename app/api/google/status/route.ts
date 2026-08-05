import { NextResponse } from "next/server";

import {
  GOOGLE_TOKEN_COOKIE,
  googleAccessToken,
  googleOAuthConfigured,
  googleWritesEnabled
} from "@/lib/google/oauth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** What the Connectors sheet needs to render the Google row without guessing. */
export async function GET() {
  const base = {
    oauthAvailable: googleOAuthConfigured(),
    writesEnabled: googleWritesEnabled()
  };

  const token = await googleAccessToken();
  if (!token) return NextResponse.json({ ...base, connected: false, email: null, scopes: [] });

  const probe = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (!probe.ok) {
    // A revoked or expired grant is a disconnected state, not an error page.
    return NextResponse.json({ ...base, connected: false, email: null, scopes: [] });
  }

  const user = (await probe.json()) as { email?: string };

  /* Ask Google what the grant actually covers rather than reporting what was
     requested. A connection made before writes were enabled keeps its old,
     narrower scopes until the user reauthorizes, and reporting the intent
     would promise a compose tool that fails at the moment it is used. */
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
    cache: "no-store"
  });
  const scopes = info.ok
    ? String(((await info.json()) as { scope?: string }).scope ?? "").split(" ").filter(Boolean)
    : [];

  return NextResponse.json({ ...base, connected: true, email: user.email ?? null, scopes });
}

export function DELETE() {
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(GOOGLE_TOKEN_COOKIE);
  return response;
}
