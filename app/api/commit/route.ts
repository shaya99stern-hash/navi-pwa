import { NextResponse } from "next/server";

import { authorizeApiMutation, authorizeApiRead } from "@/lib/auth/api";
import { readCredential } from "@/lib/ai/credentials";

/* Node runtime on purpose: Buffer handles UTF-8 base64 correctly, which the
   Edge atob/btoa pair does not. */
export const dynamic = "force-dynamic";

/**
 * The self-update engine's write path: read a file from the app's own
 * repository, and commit a replacement. Vercel's GitHub integration deploys
 * every commit, so a commit here *is* a deployment.
 *
 * The previous version of this route answered to anyone on the internet —
 * an unauthenticated POST could commit to the repository with the server's
 * token. It now passes the same mutation guard as every other write route.
 */

const TIMEOUT_MS = 15_000;
const MAX_CONTENT_BYTES = 900_000;

function repoConfig(): { token: string | null; owner: string; repo: string } {
  return {
    token: readCredential("github") ?? null,
    owner: process.env.GITHUB_OWNER || "shaya99stern-hash",
    repo: process.env.GITHUB_REPO || "navi-pwa"
  };
}

/** Reject traversal and any segment that could smuggle a query or ref. */
function safeRepoPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const segments = trimmed.split("/");
  const invalid = !trimmed
    || trimmed.startsWith("/")
    || trimmed.includes("\\")
    || trimmed.includes("..")
    || segments.some((segment) => !segment || !/^[A-Za-z0-9._-]+$/.test(segment));
  return invalid ? null : segments.map((segment) => encodeURIComponent(segment)).join("/");
}

async function githubFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "NaviOS-App",
        ...(init.headers ?? {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Read a file so the panel edits real content instead of a blind paste. */
export async function GET(request: Request) {
  /* A read, so the read guard: the mutation guard also requires an Origin
     header, which browsers omit on same-origin GETs — it refused every Load. */
  const refusal = await authorizeApiRead(request);
  if (refusal) return refusal;

  const { token, owner, repo } = repoConfig();
  if (!token) return NextResponse.json({ error: "Server misconfiguration: GITHUB_PAT missing." }, { status: 503 });

  const path = safeRepoPath(new URL(request.url).searchParams.get("path"));
  if (!path) return NextResponse.json({ error: "Invalid path." }, { status: 400 });

  const response = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, token);
  if (response.status === 404) return NextResponse.json({ error: "That file does not exist in the repository." }, { status: 404 });
  if (!response.ok) return NextResponse.json({ error: `GitHub returned ${response.status}.` }, { status: 502 });

  const data = (await response.json()) as { content?: string; encoding?: string; sha?: string; size?: number };
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    return NextResponse.json({ error: "That path is not a readable file." }, { status: 400 });
  }
  const content = Buffer.from(data.content, "base64").toString("utf8");
  return NextResponse.json({ content, sha: data.sha, size: data.size });
}

export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const { token, owner, repo } = repoConfig();
  if (!token) return NextResponse.json({ error: "Server misconfiguration: GITHUB_PAT missing." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { path?: unknown; content?: unknown; commitMessage?: unknown } | null;
  const path = safeRepoPath(body?.path);
  const content = typeof body?.content === "string" ? body.content : null;
  if (!path || content === null) return NextResponse.json({ error: "Missing path or content." }, { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json({ error: "That file is too large to commit from here." }, { status: 413 });
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  // The existing sha, when the file exists — required by GitHub to update it.
  let sha: string | undefined;
  const existing = await githubFetch(url, token);
  if (existing.ok) {
    const data = (await existing.json()) as { sha?: string };
    sha = data.sha;
  }

  const commit = await githubFetch(url, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: typeof body?.commitMessage === "string" && body.commitMessage.trim()
        ? body.commitMessage.trim().slice(0, 300)
        : `Update ${path} via NaviOS`,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha
    })
  });
  const result = (await commit.json()) as { message?: string; commit?: { html_url?: string; sha?: string } };
  if (!commit.ok) {
    return NextResponse.json({ error: result.message || "GitHub commit failed." }, { status: commit.status });
  }

  return NextResponse.json({
    success: true,
    commitUrl: result.commit?.html_url ?? null,
    commitSha: result.commit?.sha ?? null
  });
}
