import { NextResponse } from "next/server";

import { authorizeApiMutation, authorizeApiRead } from "@/lib/auth/api";
import { PROVIDER_CATALOG, catalogEnvKeys, findProvider } from "@/lib/ai/provider-catalog";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * NaviOS configuring itself.
 *
 * Adding a provider meant leaving the app, finding the Vercel dashboard on a
 * phone, typing an environment variable name exactly right, and redeploying.
 * That is the whole reason keys went unset for weeks and features looked
 * broken when they were merely unconfigured.
 *
 * This writes the variable through Vercel's own API with the deployment's
 * token and triggers a redeploy, so naming a provider and pasting a key is
 * the entire flow. The key is written and never read back: Vercel does not
 * return secret values, and this route never asks for one.
 *
 * Only variables the catalog knows can be set. An open-ended "write any
 * environment variable" endpoint reachable from a chat message is a way to
 * overwrite the app's own credentials, so the allow-list is the security
 * boundary rather than a convenience.
 */

const TIMEOUT_MS = 15_000;

function vercelCredentials(): { token: string; projectId: string; teamId: string } | null {
  const token = (process.env.NAVI_VERCEL_TOKEN ?? process.env.VERCEL_API_TOKEN ?? process.env.VERCEL_TOKEN ?? "").trim();
  const projectId = (process.env.NAVI_VERCEL_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID ?? "").trim();
  const teamId = (process.env.NAVI_VERCEL_TEAM_ID ?? process.env.VERCEL_TEAM_ID ?? "").trim();
  return token && projectId ? { token, projectId, teamId } : null;
}

async function vercelFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`https://api.vercel.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "NaviOS-Provision/1.0",
        ...(init.headers ?? {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/** What can be connected, and what already is. Never a secret value. */
export async function GET(request: Request) {
  const refusal = await authorizeApiRead(request);
  if (refusal) return refusal;

  const credentials = vercelCredentials();
  return NextResponse.json({
    /* Whether NaviOS can configure itself at all. Without this the sheet must
       fall back to telling the user where to paste the key by hand. */
    selfConfigurable: Boolean(credentials),
    setupHint: credentials
      ? null
      : "Add NAVI_VERCEL_TOKEN and NAVI_VERCEL_PROJECT_ID in Vercel once, and NaviOS can set every other key itself.",
    providers: PROVIDER_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      envKey: entry.envKey,
      keyUrl: entry.keyUrl,
      free: entry.free,
      detail: entry.detail,
      /* Presence only. The value is never sent to the browser. */
      configured: Boolean(process.env[entry.envKey]?.trim())
    }))
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const credentials = vercelCredentials();
  if (!credentials) {
    return NextResponse.json({
      error: "NaviOS cannot configure itself yet. Add NAVI_VERCEL_TOKEN and NAVI_VERCEL_PROJECT_ID in Vercel once, and it can set every other key from here."
    }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { provider?: unknown; value?: unknown; redeploy?: unknown } | null;
  const providerName = typeof body?.provider === "string" ? body.provider : "";
  const value = typeof body?.value === "string" ? body.value.trim() : "";
  if (!providerName || !value) return NextResponse.json({ error: "A provider and a key are both required." }, { status: 400 });

  const entry = findProvider(providerName);
  if (!entry) {
    return NextResponse.json({
      error: `NaviOS does not recognise "${providerName}". Known: ${PROVIDER_CATALOG.map((row) => row.label).join(", ")}.`
    }, { status: 400 });
  }
  /* Belt and braces: findProvider can only return catalog rows, but the
     allow-list is what makes this endpoint safe, so it is checked rather than
     assumed. */
  if (!catalogEnvKeys().has(entry.envKey)) {
    return NextResponse.json({ error: "That variable cannot be set from here." }, { status: 400 });
  }

  const team = credentials.teamId ? `?teamId=${encodeURIComponent(credentials.teamId)}` : "";
  const payload = {
    key: entry.envKey,
    value,
    type: entry.envKey.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted",
    target: ["production", "preview", "development"]
  };

  /* upsert=true replaces an existing variable instead of failing with a
     conflict, which is what "I pasted a new key" means every time. */
  const response = await vercelFetch(
    `/v10/projects/${encodeURIComponent(credentials.projectId)}/env${team ? `${team}&upsert=true` : "?upsert=true"}`,
    credentials.token,
    { method: "POST", body: JSON.stringify(payload) }
  );

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error("NaviOS could not write an environment variable:", response.status, detail);
    return NextResponse.json({
      error: response.status === 403
        ? "The Vercel token was rejected. It needs access to this project."
        : `Vercel refused the change (${response.status}).`
    }, { status: 502 });
  }

  /* A variable only takes effect on the next deployment, so not redeploying
     would leave the app in the exact state the user was trying to escape:
     configured and still not working. */
  let redeployed = false;
  if (body?.redeploy !== false) {
    const hook = (process.env.NAVI_VERCEL_DEPLOY_HOOK ?? "").trim();
    if (hook.startsWith("https://api.vercel.com/")) {
      redeployed = (await fetch(hook, { method: "POST" }).catch(() => null))?.ok === true;
    }
  }

  return NextResponse.json({
    saved: true,
    envKey: entry.envKey,
    label: entry.label,
    redeployed,
    note: redeployed
      ? `${entry.label} is set and a deployment has started. It will be live in a couple of minutes.`
      : `${entry.label} is set. It takes effect on the next deployment — push any change, or redeploy from Vercel.`
  });
}
