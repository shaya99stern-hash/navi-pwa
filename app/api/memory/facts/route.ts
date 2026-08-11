import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { getRequestClerkSessionToken } from "@/lib/auth/session";
import { getRequestClerkUserId } from "@/lib/auth/session";
import {
  describeFactsConfigGap,
  factsConfigured,
  forgetFact,
  listFacts,
  rememberFact
} from "@/lib/memory/facts";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * What Navi Soul remembers, and the ability to forget it.
 *
 * The same Clerk session token the app already holds is what Supabase's
 * row-level security keys on, so this route never needs a service role and
 * cannot reach another person's rows. It forwards, it does not elevate.
 */

const OFF = { configured: false, facts: [] as const };

async function token(request: Request): Promise<{ token: string; userId: string } | null> {
  const value = getRequestClerkSessionToken(request);
  const userId = await getRequestClerkUserId(request);
  return value && userId ? { token: value, userId } : null;
}

export async function GET(request: Request) {
  if (!factsConfigured()) return NextResponse.json(OFF);
  const auth = await token(request);
  if (!auth) return NextResponse.json(OFF);
  return NextResponse.json({ configured: true, facts: await listFacts(auth.token) });
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  if (!factsConfigured()) {
    console.error(describeFactsConfigGap());
    return NextResponse.json({ error: "Remembered facts are not configured on this deployment." }, { status: 503 });
  }
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { fact?: unknown; sourceChatId?: unknown } | null;
  const fact = typeof body?.fact === "string" ? body.fact : "";
  if (!fact.trim()) return NextResponse.json({ error: "There was nothing to remember." }, { status: 400 });

  const stored = await rememberFact(
    auth.token,
    auth.userId,
    fact,
    typeof body?.sourceChatId === "string" ? body.sourceChatId : undefined
  );
  return stored
    ? NextResponse.json({ fact: stored })
    : NextResponse.json({ error: "That could not be saved." }, { status: 502 });
}

export async function DELETE(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  /* Deleting is the one operation that must never fail quietly: someone
     removing a fact is exercising a privacy decision, and a silent no-op would
     leave them believing it is gone. */
  return (await forgetFact(auth.token, id))
    ? NextResponse.json({ forgotten: true })
    : NextResponse.json({ error: "That could not be removed." }, { status: 502 });
}
