import { NextResponse } from "next/server";
import { authorizeApiRead } from "@/lib/auth/api";
import { readCredential } from "@/lib/ai/credentials";
import { readVercel } from "@/lib/vercel/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refusal = await authorizeApiRead(request);
  if (refusal) return refusal;
  const base = { oauthAvailable: false, writesEnabled: false };
  const json = (data: object) => NextResponse.json({ ...base, ...data }, { headers: { "Cache-Control": "no-store" } });
  if (!readCredential("vercel")) return json({ connected: false, login: null, error: "Add a Vercel access token under Model providers and services." });
  try {
    // Verify the permission the chat tools actually need, not just identity.
    await readVercel("/v9/projects?limit=1");
    return json({ connected: true, login: "Workspace" });
  } catch (error) {
    return json({ connected: false, login: null, error: error instanceof Error ? error.message : "Vercel could not be reached." });
  }
}
