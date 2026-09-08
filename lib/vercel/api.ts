import { readCredential } from "@/lib/ai/credentials";

export function vercelApiUrl(path: string): URL {
  const url = new URL(path, "https://api.vercel.com");
  if (url.origin !== "https://api.vercel.com") throw new Error("Invalid Vercel API destination.");
  const team = process.env.NAVI_VERCEL_TEAM_ID?.trim() || process.env.VERCEL_TEAM_ID?.trim() || process.env.VERCEL_ORG_ID?.trim();
  if (team) url.searchParams.set("teamId", team);
  return url;
}

export async function readVercel(path: string, signal?: AbortSignal): Promise<any> {
  const token = readCredential("vercel");
  if (!token) throw new Error("Vercel is not connected. Add a Vercel access token in Connectors.");
  const response = await fetch(vercelApiUrl(path), {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "NaviOS-Hub" },
    cache: "no-store", redirect: "error", signal: signal ?? AbortSignal.timeout(12_000)
  });
  if (response.status === 401) throw new Error("Vercel rejected the token. Reconnect with a valid access token.");
  if (response.status === 403) throw new Error("Vercel refused access. Check the token's team scope.");
  if (!response.ok) throw new Error(`Vercel returned ${response.status}.`);
  return response.json();
}
