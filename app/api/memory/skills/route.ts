import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import {
  forgetSkill,
  learnedSkillsConfigured,
  listLearnedSkills,
  rememberSkill
} from "@/lib/memory/learned-skills";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** What Navi Soul has learned, and the ability to unlearn it. */

const OFF = { configured: false, skills: [] as const };

async function token(request: Request): Promise<{ token: string; userId: string } | null> {
  const value = getRequestClerkSessionToken(request);
  const userId = await getRequestClerkUserId(request);
  return value && userId ? { token: value, userId } : null;
}

export async function GET(request: Request) {
  if (!learnedSkillsConfigured()) return NextResponse.json(OFF);
  const auth = await token(request);
  if (!auth) return NextResponse.json(OFF);
  return NextResponse.json({ configured: true, skills: await listLearnedSkills(auth.token) });
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (!learnedSkillsConfigured()) return NextResponse.json({ error: "Learned skills are not configured on this deployment." }, { status: 503 });
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown; instructions?: unknown; sourceUrl?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const instructions = typeof body?.instructions === "string" ? body.instructions : "";
  if (!name.trim() || !instructions.trim()) return NextResponse.json({ error: "A skill needs a name and instructions." }, { status: 400 });

  const stored = await rememberSkill(auth.token, auth.userId, {
    name,
    description: typeof body?.description === "string" ? body.description : "",
    instructions,
    sourceUrl: typeof body?.sourceUrl === "string" ? body.sourceUrl : undefined
  });
  /* The store's own reason, passed through. A 502 saying "could not be stored"
     is what left everyone guessing; the caller can act on "the table does not
     exist" and cannot act on "no". */
  if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 502 });
  return NextResponse.json({ skill: stored.skill });
}

export async function DELETE(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;
  if (!learnedSkillsConfigured()) return NextResponse.json({ deleted: false });
  const auth = await token(request);
  if (!auth) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which skill?" }, { status: 400 });
  return NextResponse.json({ deleted: await forgetSkill(auth.token, id) });
}
