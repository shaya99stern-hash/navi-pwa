import { NextResponse } from "next/server";

import { describeAttempts, discoverFromSpec } from "@/lib/ai/capabilities/discover";
import { authorizeApiMutation } from "@/lib/auth/api";

export const runtime = "edge";

/**
 * Find out what an API can do, before it is saved.
 *
 * ## Why this is a server route
 *
 * Discovery is a cross-origin fetch to somebody else's host, and a browser will
 * refuse it: almost no API sends the CORS headers that would let a page on this
 * origin read its own spec. Running it here is not a preference, it is the only
 * place it can run at all.
 *
 * Doing it server-side also means the SSRF guards apply — https only, no
 * private or link-local host, every redirect hop re-validated — which is the
 * same posture every other outbound fetch in this app takes, for the same
 * reason: the address comes from outside.
 *
 * ## What is deliberately not sent
 *
 * The credential. Discovery reads a public description of an API, and a spec
 * that needs a key to read is rare enough not to be worth handing this route a
 * secret it has no other use for. The key is typed on the device, stored there,
 * and travels with the chat request when a call is actually made — which is the
 * path custom connector keys already take, and the reason the server holds
 * none.
 *
 * The manifest comes back and is saved on the device. Nothing is stored here.
 */

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  let body: { baseUrl?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request was not JSON." }, { status: 400 });
  }

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  if (!baseUrl) return NextResponse.json({ error: "An API address is required." }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  /* Derived from the host when nothing better is available, and overwritten by
     the spec's own title the moment one is found. An id is what the model will
     address the API by, so it is kept to something a model can type back. */
  let id = "";
  try {
    id = new URL(baseUrl).hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/gi, "").slice(0, 40).toLowerCase();
  } catch {
    return NextResponse.json({ error: "That is not a valid address." }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "That address has no usable name." }, { status: 400 });

  const found = await discoverFromSpec({ baseUrl, id, name: name || undefined, signal: request.signal });

  if (!found.ok) {
    /* The attempts come back with the failure. "We could not find a spec" with
       nothing behind it is indistinguishable from not having looked, and this
       is the screen where someone decides whether their API is supported. */
    return NextResponse.json({
      ok: false,
      error: found.reason,
      attempts: found.attempts,
      detail: describeAttempts(found.attempts)
    });
  }

  return NextResponse.json({
    ok: true,
    manifest: found.manifest,
    specUrl: found.specUrl,
    /* Counted here rather than on the device, so the screen states a fact about
       what was read rather than re-deriving one. */
    summary: {
      operations: found.manifest.operations.length,
      reads: found.manifest.operations.filter((operation) => !operation.writes).length,
      writes: found.manifest.operations.filter((operation) => operation.writes).length,
      auth: found.manifest.auth.kind,
      /* Present only when the spec declared more than was kept. A large API
         quietly becoming its first 120 operations is a loss the person adding
         it should hear about at the moment they add it, not months later when
         something they read in the docs turns out not to be there. */
      ...(found.manifest.truncated ? { truncated: found.manifest.truncated } : {})
    }
  });
}
