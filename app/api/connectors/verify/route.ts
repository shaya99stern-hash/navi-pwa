import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { PROVIDERS, providerApiKey, modelsProbe } from "@/lib/ai/provider-registry";
import { findProvider, isEntryConfigured } from "@/lib/ai/provider-catalog";
import type { ProviderName } from "@/lib/ai/types";
import { readCredential } from "@/lib/ai/credentials";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Does this connector actually work?
 *
 * "Configured" only means a variable is set. A key that is expired, revoked,
 * mistyped, or lacking the permission the feature needs looks identical to a
 * working one — which is exactly how transcription failed for days while the
 * token sat there looking fine. This makes the smallest real call each
 * service offers and reports what came back.
 *
 * The key never leaves the server, and no answer here includes it.
 */

const TIMEOUT_MS = 12_000;

type Probe = { url: string; headers: Record<string, string>; method?: string; body?: string };

/** Model providers list their catalogue; that proves key, host, and account. */
const ADAPTER_FOR_ENTRY: Record<string, ProviderName> = {
  groq: "groq", gemini: "gemini", huggingface: "huggingface", cerebras: "cerebras",
  openrouter: "openrouter", together: "together", nvidia: "nvidia",
  sambanova: "sambanova", mistral: "mistral", deepseek: "deepseek"
};

function probeFor(id: string): Probe | null {
  const adapter = ADAPTER_FOR_ENTRY[id];
  if (adapter) {
    const key = providerApiKey(PROVIDERS[adapter]);
    if (!key) return null;
    /* How each provider wants to be asked lives in the registry. It used to be
       spelled out here, and separately in two other files, which is how one of
       them ended up querying a Gemini URL that does not exist. */
    return modelsProbe(PROVIDERS[adapter], key);
  }

  if (id === "tavily") {
    const key = (process.env.TAVILY_API_KEY ?? "").trim();
    return key
      ? { url: "https://api.tavily.com/search", method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "ping", max_results: 1 }) }
      : null;
  }
  if (id === "exa") {
    const key = (process.env.EXA_API_KEY ?? "").trim();
    return key
      ? { url: "https://api.exa.ai/search", method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ query: "ping", numResults: 1 }) }
      : null;
  }
  if (id === "supabase-url" || id === "supabase-key") {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
    const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
    return url && key ? { url: `${url}/rest/v1/`, headers: { apikey: key, Authorization: `Bearer ${key}` } } : null;
  }
  if (id === "github-pat") {
    const key = readCredential("github") ?? "";
    return key ? { url: "https://api.github.com/user", headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json", "User-Agent": "NaviOS/1.0" } } : null;
  }
  if (id === "vercel") {
    const key = (process.env.NAVI_VERCEL_TOKEN ?? process.env.VERCEL_API_TOKEN ?? process.env.VERCEL_TOKEN ?? "").trim();
    return key ? { url: "https://api.vercel.com/v2/user", headers: { Authorization: `Bearer ${key}` } } : null;
  }
  return null;
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as { provider?: unknown } | null;
  const name = typeof body?.provider === "string" ? body.provider : "";
  const entry = name ? findProvider(name) : null;
  if (!entry) return NextResponse.json({ error: "Unknown service." }, { status: 400 });

  if (!isEntryConfigured(entry)) {
    return NextResponse.json({ ok: false, reason: "No key is set for this service yet." });
  }

  const probe = probeFor(entry.id);
  if (!probe) {
    /* Honest rather than green: some rows are a setting rather than a service
       — there is nothing to call, so nothing is claimed. */
    return NextResponse.json({ ok: true, reason: "Set. This one has no endpoint to test against." });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(probe.url, {
      method: probe.method ?? "GET",
      headers: probe.headers,
      body: probe.body,
      cache: "no-store",
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ ok: false, reason: "The key was rejected. It is expired, revoked, or lacks the needed permission." });
    }
    if (response.status === 429) {
      return NextResponse.json({ ok: true, reason: "Working, but rate limited right now." });
    }
    if (!response.ok) {
      return NextResponse.json({ ok: false, reason: `The service answered ${response.status}.` });
    }
    return NextResponse.json({ ok: true, reason: "Answered normally." });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ ok: false, reason: aborted ? "Timed out." : "Could not be reached." });
  } finally {
    clearTimeout(timer);
  }
}
