import { NextResponse } from "next/server";

import { assertFetchableUrl } from "@/lib/ai/web-tools";
import { authorizeApiMutation } from "@/lib/auth/api";

export const runtime = "edge";

/**
 * Prove a custom connector works before saving it.
 *
 * Same philosophy as the Integrations sheet: "connected" must mean the
 * endpoint answered with the credential, not that a string was typed. The
 * key arrives with this request and leaves with the response — nothing is
 * stored here. The URL passes the private-address guard because a typed-in
 * connector is still an outbound request made from our network.
 */

const TIMEOUT_MS = 10_000;

type Probe = { url: string; headers: Record<string, string> };

function probeFor(kind: string, baseUrl: string, apiKey: string): Probe | null {
  const base = assertFetchableUrl(baseUrl).toString().replace(/\/+$/, "");
  if (kind === "openai") return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
  if (kind === "anthropic") return { url: `${base}/v1/models`, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } };
  if (kind === "supabase") return { url: `${base}/rest/v1/`, headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } };
  if (kind === "mcp") return { url: base, headers: {} };
  return null;
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as { kind?: unknown; baseUrl?: unknown; apiKey?: unknown } | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
  if (!kind || !baseUrl) return NextResponse.json({ ok: false, error: "A connector type and base URL are required." }, { status: 400 });

  let probe: Probe | null;
  try {
    probe = probeFor(kind, baseUrl, apiKey);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "That URL cannot be used." });
  }
  if (!probe) return NextResponse.json({ ok: false, error: "Unknown connector type." }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(probe.url, { headers: probe.headers, cache: "no-store", signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ ok: false, error: "The endpoint answered but rejected the key. Check the credential." });
    }
    if (!response.ok && kind !== "mcp") {
      return NextResponse.json({ ok: false, error: `The endpoint returned ${response.status}.` });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "The endpoint could not be reached." });
  } finally {
    clearTimeout(timer);
  }
}
