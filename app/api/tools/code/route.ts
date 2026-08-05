import { NextResponse } from "next/server";

import { describeSandboxResult, runPython } from "@/lib/execution/vercel-sandbox";

/**
 * Python execution, on Node because the sandbox SDK cannot run anywhere else.
 *
 * This is the whole reason the runtime split exists. The chat route is Edge for
 * time to first token and must stay that way; the sandbox needs Node. Rather
 * than compromise one for the other, the capability lives behind its own route
 * and the chat route reaches it over HTTP.
 *
 * The alternative — importing the sandbox module into the chat route — fails at
 * build time with an error that reads like a missing dependency rather than a
 * runtime mismatch, which is a genuinely expensive hour to lose.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The sandbox itself is capped at thirty seconds; this leaves room for the
   round trip either side of it without the platform cutting the request. */
export const maxDuration = 60;

const MAX_SOURCE_BYTES = 100_000;

export async function POST(request: Request) {
  let body: { source?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) return NextResponse.json({ error: "No source was supplied." }, { status: 400 });
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "That program is too large to run." }, { status: 413 });
  }

  /* Python only. JavaScript is served by the worker on the device, which is
     faster for it, and rejecting anything else at the boundary means the
     sandbox never starts for a language it has no interpreter for. */
  const language = typeof body.language === "string" ? body.language.toLowerCase() : "python";
  if (language !== "python" && language !== "py") {
    return NextResponse.json({ error: "This endpoint runs Python. JavaScript runs on the device." }, { status: 400 });
  }

  const result = await runPython(source);
  return NextResponse.json({ ...result, summary: describeSandboxResult(result) });
}
