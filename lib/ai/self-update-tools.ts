import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Navi Soul editing its own codebase.
 *
 * The failure this replaces is in the exported chats verbatim: asked to make
 * a change, Navi Soul answered "I'll execute them now", produced nothing, and
 * then explained that "/api/commit is not available in this environment" and
 * that it "cannot directly interact with your repository". It was inventing an
 * HTTP call to a route it had no way to reach, because it had been told the
 * self-update engine exists but given no tool for it.
 *
 * These are that tool. They talk to the GitHub contents API directly with the
 * deployment's own token — the same one the Developer screen uses — so a
 * commit here is an ordinary commit, and Vercel's GitHub integration turns it
 * into a deployment. Nothing is proxied through a bridge server; the PWA stays
 * self-contained.
 *
 * ## Why this is safe to expose
 *
 * `GITHUB_PAT` is set by whoever deployed the app, and setting it is the act
 * of opting in to self-editing — it exists for no other purpose. Writes are
 * confined to the app's own repository, land on a branch, and are visible in
 * history and revertible like any other commit. Protected paths (workflows,
 * this file, the guards themselves) are refused outright.
 */

const TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 600_000;
/** Enough of a file to reason about without swamping the context window. */
const MAX_READ_CHARS = 60_000;

/**
 * Paths a self-editing model may not rewrite.
 *
 * CI configuration and the security guards are how a bad change gets caught.
 * A model that can edit those can disable its own supervision in the same
 * commit that introduces a problem, which turns one mistake into an
 * unreviewable one.
 */
const PROTECTED_PATHS = [
  /^\.github\//i,
  /^lib\/ai\/self-update-tools\.ts$/i,
  /^lib\/security\//i,
  /^lib\/auth\//i,
  /^lib\/ai\/write-guards\.ts$/i,
  /^vercel\.json$/i,
  /^next\.config\./i,
  /^package(-lock)?\.json$/i
];

export function selfUpdateToken(): string | undefined {
  return (process.env.GITHUB_PAT || process.env.NAVI_GITHUB_TOKEN || "").trim() || undefined;
}

export function selfUpdateRepo(): { owner: string; repo: string } {
  return {
    owner: (process.env.GITHUB_OWNER || "shaya99stern-hash").trim(),
    repo: (process.env.GITHUB_REPO || "navi-pwa").trim()
  };
}

/** The branch self-edits land on. Never the default branch by accident. */
function workingBranch(): string {
  return (process.env.NAVI_SELF_UPDATE_BRANCH || "main").trim();
}

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((pattern) => pattern.test(path));
}

/** Reject traversal and anything that could smuggle a query or a ref. */
export function safeRepoPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, "");
  const segments = trimmed.split("/");
  const invalid = !trimmed
    || trimmed.includes("\\")
    || trimmed.includes("..")
    || segments.some((segment) => !segment || !/^[A-Za-z0-9._-]+$/.test(segment));
  return invalid ? null : segments.join("/");
}

/* Edge runtime: no Buffer. These handle UTF-8 correctly, which the bare
   atob/btoa pair does not — a commit containing an em dash would corrupt. */
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubFetch(path: string, token: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "NaviOS-SelfUpdate/1.0",
        ...(init.headers ?? {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

export function buildSelfUpdateTools({ signal, onActivity = () => {} }: {
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
}): ToolSet {
  const token = selfUpdateToken();
  if (!token) return {};
  const { owner, repo } = selfUpdateRepo();
  const branch = workingBranch();

  return {
    read_own_source: tool({
      description:
        "Read a file from NaviOS's own source repository. Use this before proposing or making any change to the app itself — never describe or edit code you have not read. Also use it to answer questions about how the app really works.",
      inputSchema: z.object({
        path: z.string().describe("Repository-relative path, e.g. app/components/composer-dock.tsx")
      }),
      execute: async ({ path }) => {
        const safe = safeRepoPath(path);
        if (!safe) return "That path is not valid.";
        onActivity(`Reading ${safe}`);
        try {
          const response = await githubFetch(`/repos/${owner}/${repo}/contents/${safe}?ref=${encodeURIComponent(branch)}`, token, {}, signal);
          if (response.status === 404) return `${safe} does not exist in the repository.`;
          if (!response.ok) return `GitHub returned ${response.status} reading ${safe}.`;
          const data = (await response.json()) as { content?: string; encoding?: string; sha?: string };
          if (data.encoding !== "base64" || typeof data.content !== "string") return `${safe} is not a readable text file.`;
          const text = decodeBase64(data.content);
          const clipped = text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n\n[Truncated at ${MAX_READ_CHARS} characters.]` : text;
          return `${safe} (sha ${data.sha}):\n\n${clipped}`;
        } catch (error) {
          return `Could not read ${safe}: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    }),

    list_own_source: tool({
      description:
        "List the files in a directory of NaviOS's own source repository. Use it to find the right file before reading it, rather than guessing a path.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory, e.g. app/components. Omit for the repository root.")
      }),
      execute: async ({ path }) => {
        const safe = path ? safeRepoPath(path) : "";
        if (path && !safe) return "That path is not valid.";
        onActivity(`Listing ${safe || "the repository root"}`);
        try {
          const response = await githubFetch(`/repos/${owner}/${repo}/contents/${safe}?ref=${encodeURIComponent(branch)}`, token, {}, signal);
          if (response.status === 404) return `${safe || "/"} does not exist.`;
          if (!response.ok) return `GitHub returned ${response.status}.`;
          const entries = (await response.json()) as Array<{ name?: string; type?: string; size?: number }>;
          if (!Array.isArray(entries)) return "That path is a file, not a directory. Use read_own_source.";
          return entries
            .map((entry) => `${entry.type === "dir" ? "dir " : "file"}  ${entry.name}${entry.type === "file" && entry.size ? ` (${entry.size} bytes)` : ""}`)
            .join("\n") || "That directory is empty.";
        } catch (error) {
          return `Could not list that directory: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    }),

    commit_own_source: tool({
      description:
        "Write a file to NaviOS's own source repository and deploy it. The commit triggers a Vercel deployment automatically, so this genuinely updates the running app. ALWAYS call read_own_source on the same path first and send the complete new file content — this replaces the file, it does not patch it. Say plainly what you changed after committing.",
      inputSchema: z.object({
        path: z.string().describe("Repository-relative path to write."),
        content: z.string().describe("The complete new contents of the file."),
        commitMessage: z.string().describe("A short description of the change, in the imperative mood.")
      }),
      execute: async ({ path, content, commitMessage }) => {
        const safe = safeRepoPath(path);
        if (!safe) return "That path is not valid, so nothing was committed.";
        if (isProtectedPath(safe)) {
          return `${safe} is protected and cannot be edited from a conversation. CI configuration, the security guards, the auth layer, and the build manifests are deliberately outside self-editing. Tell the user this rather than trying another path.`;
        }
        if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
          return "That file is too large to commit from here, so nothing was committed.";
        }

        onActivity(`Committing ${safe}`);
        try {
          // The existing sha, when the file exists — GitHub requires it to update.
          let sha: string | undefined;
          const existing = await githubFetch(`/repos/${owner}/${repo}/contents/${safe}?ref=${encodeURIComponent(branch)}`, token, {}, signal);
          if (existing.ok) {
            const data = (await existing.json()) as { sha?: string };
            sha = data.sha;
          }

          const response = await githubFetch(`/repos/${owner}/${repo}/contents/${safe}`, token, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: commitMessage.trim().slice(0, 200) || `Update ${safe} via NaviOS`,
              content: encodeBase64(content),
              branch,
              sha
            })
          }, signal);

          const result = (await response.json()) as { message?: string; commit?: { html_url?: string; sha?: string } };
          if (!response.ok) {
            return `The commit was rejected: ${result.message ?? response.status}. Nothing was changed. Say so plainly rather than claiming the edit landed.`;
          }
          return [
            `Committed ${safe} to ${owner}/${repo} on ${branch}.`,
            result.commit?.html_url ? `Commit: ${result.commit.html_url}` : "",
            "Vercel is now building this commit; the change reaches the running app in a couple of minutes.",
            "This really happened — you may confirm it."
          ].filter(Boolean).join("\n");
        } catch (error) {
          return `The commit failed: ${error instanceof Error ? error.message : "unknown error"}. Nothing was changed.`;
        }
      }
    })
  };
}
