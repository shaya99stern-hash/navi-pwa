import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import {
  cloudMemoryConfigured,
  deleteCloudChat,
  listCloudChats,
  upsertCloudChats
} from "@/lib/memory/cloud";
import type { StoredChat } from "@/lib/ai/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Conversations that follow the person across devices.
 *
 * Same trust shape as remembered facts: the caller's own Clerk session token
 * is forwarded to Supabase, where row-level security keys on it. This route
 * forwards, it does not elevate.
 */

const OFF = { configured: false, chats: [] as const };
/** More per call is a slow request on a phone, and sync batches small anyway. */
const MAX_CHATS_PER_PUSH = 20;

async function token(request: Request): Promise<{ token: string; userId: string } | null> {
  const value = getRequestClerkSessionToken(request);
  const userId = await getRequestClerkUserId(request);
  return value && userId ? { token: value, userId } : null;
}

export async function GET(request: Request) {
  if (!cloudMemoryConfigured()) return NextResponse.json(OFF);
  const auth = await token(request);
  if (!auth) return NextResponse.json(OFF);
  return NextResponse.json({ configured: true, chats: await listCloudChats(auth.token) });
}

export async function PUT(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (!cloudMemoryConfigured()) return NextResponse.json({ error: "Cloud memory is not configured on this deployment." }, { status: 503 });
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { chats?: unknown } | null;
  const chats = Array.isArray(body?.chats)
    ? (body.chats as StoredChat[]).filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages)).slice(0, MAX_CHATS_PER_PUSH)
    : [];
  if (!chats.length) return NextResponse.json({ error: "There was nothing to sync." }, { status: 400 });

  const synced = await upsertCloudChats(auth.token, auth.userId, chats);
  return NextResponse.json({ synced });
}

export async function DELETE(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (!cloudMemoryConfigured()) return NextResponse.json({ deleted: false });
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which chat?" }, { status: 400 });
  return NextResponse.json({ deleted: await deleteCloudChat(auth.token, id) });
}
