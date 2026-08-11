import { NextResponse } from "next/server";

import { getRequestClerkSessionToken } from "@/lib/auth/session";
import { runAllChecks } from "@/lib/ai/diagnostic-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What is actually working, for the person rather than for the model.
 *
 * `diagnose_self` gives Navi Soul the same answer, and that is the important
 * one — it is what stops the model inventing a cause. But asking the assistant
 * to find out why the assistant is broken has an obvious weakness: the turn
 * where you most need it is the turn where something in that path may be the
 * thing that is broken. This route needs no model, no tools, and no working
 * conversation.
 *
 * It runs the identical checks rather than a parallel set, because two
 * implementations of "what is broken" would drift and the first time they
 * disagreed nobody would know which to believe.
 */
export async function GET(request: Request) {
  const checks = await runAllChecks(getRequestClerkSessionToken(request) ?? undefined);
  return NextResponse.json(
    { checks, failing: checks.filter((check) => !check.ok).length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
