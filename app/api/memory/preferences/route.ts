import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import { cloudMemoryConfigured, getCloudPreferences, putCloudPreferences } from "@/lib/memory/cloud";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Preferences that follow the person. Same forwarding contract as facts. */

const OFF = { configured: false, preferences: null };
const MAX_PREFERENCES_BYTES = 200_000;

async function token(request: Request): Promise<{ token: string; userId: string } | null> {
  const value = getRequestClerkSessionToken(request);
  const userId = await getRequestClerkUserId(request);
  return value && userId ? { token: value, userId } : null;
}

export async function GET(request: Request) {
  if (!cloudMemoryConfigured()) return NextResponse.json(OFF);
  const auth = await token(request);
  if (!auth) return NextResponse.json(OFF);
  return NextResponse.json({ configured: true, preferences: await getCloudPreferences(auth.token) });
}

export async function PUT(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (!cloudMemoryConfigured()) return NextResponse.json({ error: "Cloud memory is not configured on this deployment." }, { status: 503 });
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_PREFERENCES_BYTES) return NextResponse.json({ error: "Preferences payload is too large." }, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Preferences must be JSON." }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Preferences must be an object." }, { status: 400 });
  }

  const synced = await putCloudPreferences(auth.token, auth.userId, payload as Record<string, unknown>);
  return NextResponse.json({ synced });
}
