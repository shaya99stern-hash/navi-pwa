import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { readCredential } from "./credentials";

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
  /* Deliberate names only. `GITHUB_TOKEN` and `GH_TOKEN` are injected by CI
     platforms and agent runtimes — they were already set in this project's own
     build environment, by no person — and a token the platform handed over is
     not consent to commit to this app's own source. Reads take any name; this
     one does not. */
  return readCredential("github", { deliberate: true });
}

export function selfUpdateRepo(): { owner: string; repo: string } {
  return {
    owner: (process.env.GITHUB_OWNER || "shaya99stern-hash").trim(),
    repo: (process.env.GITHUB_REPO || "navi-pwa").trim()
  };
}

/**
 * The branch self-edits land on, which must not be the one production runs.
 *
 * The comment here always said "never the default branch by accident" and the
 * default was `main`, so the code contradicted its own stated invariant. A
 * self-edit went straight to the branch Vercel deploys — no tests, no build
 * check, no review — while every change made by a person went through all
 * three. It came within one fetch timeout of happening: the owner said
 * "Proceed. Make the changes." and only a stalled read stopped it.
 *
 * The default is now a branch of its own. `NAVI_SELF_UPDATE_BRANCH` still
 * overrides it, because an operator who genuinely wants the old behaviour
 * should be able to say so — out loud, in configuration, rather than by
 * inheriting it.
 */
export const DEFAULT_SELF_UPDATE_BRANCH = "navi/self-update";

function workingBranch(): string {
  return (process.env.NAVI_SELF_UPDATE_BRANCH || DEFAULT_SELF_UPDATE_BRANCH).trim();
}

/** The branch a pull request from a self-edit is opened against. */
function baseBranch(): string {
  return (process.env.NAVI_SELF_UPDATE_BASE || "main").trim();
}

/**
 * Make sure the working branch exists, because a commit cannot create one.
 *
 * GitHub's contents API writes to a ref that is already there and refuses
 * otherwise, so without this the very first self-edit on a fresh deployment
 * fails with a message about a missing branch — which reads like the tool
 * being broken rather than like a branch needing to exist.
 */
async function ensureBranch(owner: string, repo: string, token: string, signal?: AbortSignal): Promise<string | null> {
  const branch = workingBranch();
  const base = baseBranch();
  if (branch === base) return null;

  const existing = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token, {}, signal);
  if (existing.ok) return null;

  const head = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`, token, {}, signal);
  if (!head.ok) return `The base branch ${base} could not be read, so ${branch} could not be created.`;
  const tip = (await head.json()) as { object?: { sha?: string } };
  const sha = tip.object?.sha;
  if (!sha) return `The base branch ${base} has no commit to branch from.`;

  const created = await githubFetch(`/repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
  }, signal);
  if (!created.ok) {
    const detail = (await created.json().catch(() => ({}))) as { message?: string };
    return `The branch ${branch} could not be created: ${detail.message ?? created.status}`;
  }
  return null;
}

/**
 * Open a pull request for the self-edit, or report that one is already open.
 *
 * Returned as a sentence rather than thrown: the commit has already landed by
 * the time this runs, and a failure to open the pull request must not be
 * reported as a failure to commit. Claiming an edit did not happen when it did
 * is the one thing worse than not opening the request.
 */
async function openPullRequest(owner: string, repo: string, token: string, summary: string, signal?: AbortSignal): Promise<string> {
  const branch = workingBranch();
  const base = baseBranch();
  if (branch === base) return "";

  const open = await githubFetch(`/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`, token, {}, signal);
  if (open.ok) {
    const list = (await open.json()) as Array<{ html_url?: string }>;
    if (list.length && list[0].html_url) {
      return `It joins the pull request already open for these changes: ${list[0].html_url}`;
    }
  }

  const created = await githubFetch(`/repos/${owner}/${repo}/pulls`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: summary.slice(0, 120) || "Changes Navi Soul made to its own source",
      head: branch,
      base,
      body: "Opened by Navi Soul editing its own source. The checks on this pull request are what stand between this change and the running app."
    })
  }, signal);
  if (!created.ok) {
    const detail = (await created.json().catch(() => ({}))) as { message?: string };
    return `The change is committed on ${branch}, but a pull request could not be opened: ${detail.message ?? created.status}. Say so rather than implying it is live.`;
  }
  const pull = (await created.json()) as { html_url?: string };
  return pull.html_url ? `Pull request opened: ${pull.html_url}` : `A pull request was opened from ${branch}.`;
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
          /* The branch has to exist before anything can be written to it. */
          const missing = await ensureBranch(owner, repo, token, signal);
          if (missing) return `${missing} Nothing was committed.`;

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
          const pull = await openPullRequest(owner, repo, token, commitMessage.trim(), signal);
          return [
            `Committed ${safe} to ${owner}/${repo} on ${branch}.`,
            result.commit?.html_url ? `Commit: ${result.commit.html_url}` : "",
            pull,
            /* The old text promised the change was reaching the running app in
               a couple of minutes. On a branch that is simply untrue, and a
               false claim about deployment is worse than a slower path — the
               owner would go looking for a change that is not there. */
            branch === baseBranch()
              ? "Vercel is now building this commit; the change reaches the running app in a couple of minutes."
              : "It is NOT live yet. The tests and the build run on that pull request, and merging it is what deploys the change. Say this plainly rather than implying the app has already changed.",
            "This really happened — you may confirm it."
          ].filter(Boolean).join("\n");
        } catch (error) {
          return `The commit failed: ${error instanceof Error ? error.message : "unknown error"}. Nothing was changed.`;
        }
      }
    })
  };
}
