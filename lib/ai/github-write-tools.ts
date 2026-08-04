import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { guardWrite, workingBranchName } from "./write-guards";

/**
 * The write half of the GitHub surface. The read tools stay in dev-tools.ts and
 * are always safe; these can change a repository, so they are gated three ways:
 *
 *  1. NAVI_GITHUB_ALLOW_WRITES must be "true" — off by default.
 *  2. The token must carry `repo` scope, which only the OAuth flow requests
 *     when writes are enabled.
 *  3. Nothing ever commits to a default branch. Every edit creates or targets a
 *     working branch, and shipping it means opening a pull request the user
 *     reviews in GitHub's own UI.
 *
 * A model working from a phone should never be one malformed argument away from
 * rewriting main. The pull request is the review step, and it is not optional.
 */

const REQUEST_TIMEOUT_MS = 15_000;
/** Well past any source file; a guard against a runaway generation. */
const MAX_CONTENT_BYTES = 512 * 1024;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const BRANCH_NAME = /^[A-Za-z0-9._\/-]{1,180}$/;
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "release", "prod"]);

export type Announce = (message: string) => void;

type WriteContext = {
  token: string;
  onActivity?: Announce;
};

function repoSlug(owner: string, repo: string): string | null {
  return SEGMENT.test(owner) && SEGMENT.test(repo) ? `${owner}/${repo}` : null;
}

/** Edge has no Buffer; TextEncoder + btoa is the portable path. */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "NaviOS-Hub",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {})
      }
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub ${response.status}: ${detail.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultBranch(token: string, slug: string): Promise<string> {
  const repo = await api<{ default_branch: string }>(token, `/repos/${slug}`);
  return repo.default_branch;
}

/** The commit a new branch should start from. */
async function headSha(token: string, slug: string, branch: string): Promise<string> {
  const ref = await api<{ object: { sha: string } }>(
    token,
    `/repos/${slug}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return ref.object.sha;
}

/** Updating a file requires its current blob sha; creating one requires none. */
async function existingFileSha(token: string, slug: string, path: string, branch: string): Promise<string | undefined> {
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const file = await api<{ sha?: string }>(
      token,
      `/repos/${slug}/contents/${encoded}?ref=${encodeURIComponent(branch)}`
    );
    return file.sha;
  } catch {
    return undefined;
  }
}

export function buildGitHubWriteTools({ token, onActivity }: WriteContext): ToolSet {
  const tools: ToolSet = {};

  tools.github_create_branch = tool({
    description:
      "Create a working branch in a GitHub repository, based on the default branch or a branch you name. "
      + "Always call this before writing files; edits never go straight to the default branch.",
    inputSchema: z.object({
      owner: z.string().describe("Repository owner, e.g. 'shaya'"),
      repo: z.string().describe("Repository name, e.g. 'navi-pwa'"),
      intent: z.string().max(80).describe("A few words on what this change is, e.g. 'fix composer inset'. The branch name is generated from it."),
      from: z.string().optional().describe("Branch to base on. Defaults to the repository's default branch.")
    }),
    execute: async ({ owner, repo, intent, from }) => {
      /* Generated, not accepted. A consistent `navisol/` prefix makes every
         branch this app created identifiable in GitHub's own branch list, and
         the random suffix means two attempts at the same fix do not collide. */
      const branch = workingBranchName(intent);
      const slug = repoSlug(owner, repo);
      if (!slug) return { error: "Owner and repo must be plain repository segments." };
      if (!BRANCH_NAME.test(branch)) return { error: "That branch name contains characters git will not accept." };
      if (PROTECTED_BRANCHES.has(branch)) return { error: `'${branch}' is a protected branch name. Pick a working branch.` };

      onActivity?.(`Creating branch ${branch} in ${slug}`);
      try {
        const base = from ?? (await defaultBranch(token, slug));
        const sha = await headSha(token, slug, base);
        await api(token, `/repos/${slug}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
        });
        return { branch, basedOn: base, baseSha: sha };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not create that branch." };
      }
    }
  });

  tools.github_write_file = tool({
    description:
      "Create or replace one file on a working branch and commit it. Send the file's complete new contents, not a diff. "
      + "Refuses to write to a default or protected branch.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      branch: z.string().describe("Working branch created by github_create_branch"),
      path: z.string().describe("Repository-relative path, e.g. 'app/globals.css'"),
      content: z.string().describe("Full new contents of the file"),
      message: z.string().describe("Commit message, imperative mood")
    }),
    execute: async ({ owner, repo, branch, path, content, message }) => {
      const slug = repoSlug(owner, repo);
      if (!slug) return { error: "Owner and repo must be plain repository segments." };
      if (!BRANCH_NAME.test(branch)) return { error: "That branch name contains characters git will not accept." };
      if (PROTECTED_BRANCHES.has(branch)) return { error: `Refusing to commit directly to '${branch}'. Create a working branch first.` };
      /* Branch guards stop the wrong branch; these stop the wrong file. A bad
         commit on a working branch is reviewed and discarded, but a workflow
         file runs when the pull request opens — before anyone has read it —
         and a committed credential is compromised the moment it exists. */
      const guard = guardWrite(path, content);
      if (!guard.ok) return { error: guard.reason };
      if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
        return { error: "That file is larger than the 512 KB write limit." };
      }

      try {
        const head = await defaultBranch(token, slug);
        if (branch === head) return { error: `'${branch}' is the default branch. Create a working branch first.` };

        onActivity?.(`Committing ${path} to ${branch}`);
        const sha = await existingFileSha(token, slug, path, branch);
        const result = await api<{ commit: { sha: string; html_url: string } }>(
          token,
          `/repos/${slug}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
          {
            method: "PUT",
            body: JSON.stringify({
              message,
              content: toBase64(content),
              branch,
              ...(sha ? { sha } : {})
            })
          }
        );
        return { path, branch, created: !sha, commit: result.commit.sha, url: result.commit.html_url };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not write that file." };
      }
    }
  });

  tools.github_open_pull_request = tool({
    description:
      "Open a pull request from a working branch so the user can review the change in GitHub. "
      + "This is how edits ship; nothing merges automatically.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      head: z.string().describe("Branch containing the commits"),
      base: z.string().optional().describe("Target branch. Defaults to the repository's default branch."),
      title: z.string(),
      body: z.string().optional().describe("What changed and why, in markdown"),
      draft: z.boolean().optional().describe("Open as a draft. Defaults to false.")
    }),
    execute: async ({ owner, repo, head, base, title, body, draft }) => {
      const slug = repoSlug(owner, repo);
      if (!slug) return { error: "Owner and repo must be plain repository segments." };
      if (!BRANCH_NAME.test(head)) return { error: "That branch name contains characters git will not accept." };

      onActivity?.(`Opening pull request for ${head}`);
      try {
        const target = base ?? (await defaultBranch(token, slug));
        const pull = await api<{ number: number; html_url: string }>(token, `/repos/${slug}/pulls`, {
          method: "POST",
          body: JSON.stringify({ title, head, base: target, body: body ?? "", draft: draft ?? false })
        });
        return { number: pull.number, url: pull.html_url, base: target, head };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Could not open that pull request." };
      }
    }
  });

  return tools;
}
