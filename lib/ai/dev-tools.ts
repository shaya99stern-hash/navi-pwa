import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { githubWritesEnabled } from "../github/oauth";
import { buildGitHubWriteTools } from "./github-write-tools";

/**
 * GitHub and Vercel, as tools the model can actually call.
 *
 * These are what make Code mode a working surface rather than a prompt: read
 * a repository, read the failing workflow log, read the deployment that broke,
 * and answer from what is really there instead of from memory.
 *
 * Deliberately read-only. A model that can push commits or trigger deploys
 * from a phone, on its own judgement, is a different product with a different
 * risk profile; reading is where nearly all the value is and none of the
 * damage. Both tokens are optional — each tool appears only when its
 * credential exists, so the app runs unchanged without them.
 */

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_FILE_CHARS = 24_000;
const MAX_LOG_CHARS = 16_000;
const MAX_ITEMS = 20;

export function githubToken(): string | undefined {
  const token = process.env.NAVI_GITHUB_TOKEN?.trim()
    || process.env.GITHUB_TOKEN?.trim()
    || process.env.GH_TOKEN?.trim();
  return token || undefined;
}

export function vercelToken(): string | undefined {
  const token = process.env.NAVI_VERCEL_TOKEN?.trim() || process.env.VERCEL_API_TOKEN?.trim();
  return token || undefined;
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n\n[…truncated, ${value.length - limit} more characters]` : value;
}

/** Repository coordinates arrive as free text from a model; keep them sane. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

function repoPath(owner: string, repo: string): string | null {
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return `${owner}/${repo}`;
}

async function githubFetch(token: string, path: string, signal: AbortSignal, accept = "application/vnd.github+json"): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NaviOS-Hub"
    },
    signal
  });
  if (response.status === 404) throw new Error("Not found, or this token has no access to it.");
  if (response.status === 403) throw new Error("GitHub refused the request (rate limit, or the token lacks that scope).");
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return accept.includes("json") ? response.json() : response.text();
}

async function vercel(path: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${vercelToken()}`, "User-Agent": "NaviOS-Hub" },
    signal
  });
  if (response.status === 403) throw new Error("Vercel refused the request; the token may lack access to that scope.");
  if (!response.ok) throw new Error(`Vercel returned ${response.status}.`);
  return response.json();
}

type Announce = (label: string) => void;

export type DevToolContext = {
  /** The signed-in user's OAuth token. Falls back to the install-wide PAT. */
  githubToken?: string;
};

export function buildDevTools(onActivity?: Announce, context?: DevToolContext): ToolSet {
  const tools: ToolSet = {};
  const say = (label: string) => onActivity?.(label);
  const resolvedGithubToken = context?.githubToken?.trim() || githubToken();

  /* Shadows the module helper, so every existing tool body below sends the
     signed-in user's token without a single call-site edit. */
  const github = (path: string, signal: AbortSignal, accept = "application/vnd.github+json") =>
    githubFetch(resolvedGithubToken ?? "", path, signal, accept);

  if (resolvedGithubToken) {
    tools.github_list_repos = tool({
      description: "List the GitHub repositories this account can access, most recently pushed first. Use when the user refers to their repos without naming one.",
      inputSchema: z.object({
        query: z.string().optional().describe("Optional substring to filter repository names by.")
      }),
      execute: async ({ query }, { abortSignal }) => {
        say("Listing your repositories");
        return withTimeout(async (signal) => {
          const list = await github(`/user/repos?sort=pushed&per_page=${MAX_ITEMS * 2}`, signal) as Array<Record<string, any>>;
          const filtered = query
            ? list.filter((repo) => String(repo.full_name).toLowerCase().includes(query.toLowerCase()))
            : list;
          return {
            repositories: filtered.slice(0, MAX_ITEMS).map((repo) => ({
              full_name: repo.full_name,
              private: repo.private,
              default_branch: repo.default_branch,
              description: repo.description ?? null,
              pushed_at: repo.pushed_at
            }))
          };
        }, abortSignal);
      }
    });

    tools.github_read_file = tool({
      description: "Read a file from a GitHub repository at a given ref. Use this before describing, reviewing, or changing code so the answer reflects what the file actually contains.",
      inputSchema: z.object({
        owner: z.string().describe("Repository owner, e.g. \"octocat\"."),
        repo: z.string().describe("Repository name."),
        path: z.string().describe("File path within the repository, e.g. \"src/index.ts\"."),
        ref: z.string().optional().describe("Branch, tag, or commit SHA. Defaults to the default branch.")
      }),
      execute: async ({ owner, repo, path, ref }, { abortSignal }) => {
        const slug = repoPath(owner, repo);
        if (!slug) return { error: "Invalid owner or repository name." };
        say(`Reading ${path}`);
        return withTimeout(async (signal) => {
          const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
          const content = await github(
            `/repos/${slug}/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`,
            signal,
            "application/vnd.github.raw"
          ) as string;
          return { path, ref: ref ?? "default", content: clip(content, MAX_FILE_CHARS) };
        }, abortSignal);
      }
    });

    tools.github_list_directory = tool({
      description: "List the files and folders at a path in a GitHub repository. Use to find where something lives before reading it.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        path: z.string().optional().describe("Directory path; omit for the repository root."),
        ref: z.string().optional()
      }),
      execute: async ({ owner, repo, path, ref }, { abortSignal }) => {
        const slug = repoPath(owner, repo);
        if (!slug) return { error: "Invalid owner or repository name." };
        say(`Listing ${path || "repository root"}`);
        return withTimeout(async (signal) => {
          const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
          const encoded = (path ?? "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
          const entries = await github(`/repos/${slug}/contents/${encoded}${query}`, signal) as Array<Record<string, any>>;
          if (!Array.isArray(entries)) return { error: "That path is a file, not a directory. Use github_read_file." };
          return { entries: entries.slice(0, 100).map((entry) => ({ name: entry.name, path: entry.path, type: entry.type, size: entry.size })) };
        }, abortSignal);
      }
    });

    tools.github_search_code = tool({
      description: "Search code across the accessible GitHub repositories. Use to locate a symbol, string, or file when the path is unknown.",
      inputSchema: z.object({
        query: z.string().describe("Search terms. GitHub code-search qualifiers such as repo: and language: are supported."),
        repo: z.string().optional().describe("Optionally restrict to one repository as \"owner/name\".")
      }),
      execute: async ({ query, repo }, { abortSignal }) => {
        say(`Searching code for “${query.slice(0, 40)}”`);
        return withTimeout(async (signal) => {
          const q = repo ? `${query} repo:${repo}` : query;
          const result = await github(`/search/code?q=${encodeURIComponent(q)}&per_page=${MAX_ITEMS}`, signal) as Record<string, any>;
          return {
            total: result.total_count,
            matches: (result.items ?? []).slice(0, MAX_ITEMS).map((item: Record<string, any>) => ({
              repository: item.repository?.full_name,
              path: item.path,
              url: item.html_url
            }))
          };
        }, abortSignal);
      }
    });

    tools.github_list_pull_requests = tool({
      description: "List pull requests for a GitHub repository, newest first.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        state: z.enum(["open", "closed", "all"]).optional()
      }),
      execute: async ({ owner, repo, state }, { abortSignal }) => {
        const slug = repoPath(owner, repo);
        if (!slug) return { error: "Invalid owner or repository name." };
        say(`Checking pull requests on ${slug}`);
        return withTimeout(async (signal) => {
          const list = await github(`/repos/${slug}/pulls?state=${state ?? "open"}&per_page=${MAX_ITEMS}`, signal) as Array<Record<string, any>>;
          return {
            pull_requests: list.map((pr) => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              draft: pr.draft,
              author: pr.user?.login,
              branch: pr.head?.ref,
              url: pr.html_url,
              updated_at: pr.updated_at
            }))
          };
        }, abortSignal);
      }
    });

    tools.github_check_ci = tool({
      description: "Read the most recent GitHub Actions workflow runs for a repository, including which ones failed. Use this before guessing why CI is red.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        branch: z.string().optional().describe("Restrict to one branch.")
      }),
      execute: async ({ owner, repo, branch }, { abortSignal }) => {
        const slug = repoPath(owner, repo);
        if (!slug) return { error: "Invalid owner or repository name." };
        say(`Checking CI on ${slug}`);
        return withTimeout(async (signal) => {
          const query = branch ? `&branch=${encodeURIComponent(branch)}` : "";
          const result = await github(`/repos/${slug}/actions/runs?per_page=10${query}`, signal) as Record<string, any>;
          return {
            runs: (result.workflow_runs ?? []).slice(0, 10).map((run: Record<string, any>) => ({
              id: run.id,
              name: run.name,
              status: run.status,
              conclusion: run.conclusion,
              branch: run.head_branch,
              commit: String(run.head_sha ?? "").slice(0, 7),
              url: run.html_url,
              created_at: run.created_at
            }))
          };
        }, abortSignal);
      }
    });

    tools.github_read_workflow_log = tool({
      description: "Read the log of a failed GitHub Actions job to see the actual error. Call github_check_ci first to get the run id.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        run_id: z.number().describe("Workflow run id from github_check_ci.")
      }),
      execute: async ({ owner, repo, run_id }, { abortSignal }) => {
        const slug = repoPath(owner, repo);
        if (!slug) return { error: "Invalid owner or repository name." };
        say("Reading the CI log");
        return withTimeout(async (signal) => {
          const jobs = await github(`/repos/${slug}/actions/runs/${run_id}/jobs`, signal) as Record<string, any>;
          const failed = (jobs.jobs ?? []).find((job: Record<string, any>) => job.conclusion === "failure") ?? (jobs.jobs ?? [])[0];
          if (!failed) return { error: "That run has no jobs." };
          // The tail carries the failure; the head is setup noise.
          const log = await github(`/repos/${slug}/actions/jobs/${failed.id}/logs`, signal, "text/plain") as string;
          return {
            job: failed.name,
            conclusion: failed.conclusion,
            log: clip(log.slice(-MAX_LOG_CHARS), MAX_LOG_CHARS)
          };
        }, abortSignal);
      }
    });
  }

  if (vercelToken()) {
    tools.vercel_list_deployments = tool({
      description: "List recent Vercel deployments with their state (READY, ERROR, BUILDING). Use to answer whether a deploy succeeded.",
      inputSchema: z.object({
        project: z.string().optional().describe("Project name or id; omit for all projects on the account.")
      }),
      execute: async ({ project }, { abortSignal }) => {
        say("Checking your deployments");
        return withTimeout(async (signal) => {
          const query = project ? `&projectId=${encodeURIComponent(project)}` : "";
          const result = await vercel(`/v6/deployments?limit=${MAX_ITEMS}${query}`, signal);
          return {
            deployments: (result.deployments ?? []).map((deployment: Record<string, any>) => ({
              uid: deployment.uid,
              name: deployment.name,
              state: deployment.state ?? deployment.readyState,
              target: deployment.target,
              url: deployment.url,
              branch: deployment.meta?.githubCommitRef,
              commit: String(deployment.meta?.githubCommitSha ?? "").slice(0, 7),
              created_at: deployment.created ? new Date(deployment.created).toISOString() : null
            }))
          };
        }, abortSignal);
      }
    });

    tools.vercel_read_build_log = tool({
      description: "Read the build log of a Vercel deployment to see why it failed. Call vercel_list_deployments first to get the uid.",
      inputSchema: z.object({
        deployment_id: z.string().describe("Deployment uid from vercel_list_deployments.")
      }),
      execute: async ({ deployment_id }, { abortSignal }) => {
        say("Reading the build log");
        return withTimeout(async (signal) => {
          const events = await vercel(`/v2/deployments/${encodeURIComponent(deployment_id)}/events?limit=400`, signal);
          const lines = (Array.isArray(events) ? events : [])
            .map((event: Record<string, any>) => (typeof event.text === "string" ? event.text : event.payload?.text))
            .filter((line: unknown): line is string => typeof line === "string" && line.trim().length > 0);
          return { log: clip(lines.join("\n").slice(-MAX_LOG_CHARS), MAX_LOG_CHARS) };
        }, abortSignal);
      }
    });

    tools.vercel_list_projects = tool({
      description: "List Vercel projects on this account, with their framework and production domain.",
      inputSchema: z.object({}),
      execute: async (_input, { abortSignal }) => {
        say("Listing your Vercel projects");
        return withTimeout(async (signal) => {
          const result = await vercel(`/v9/projects?limit=${MAX_ITEMS}`, signal);
          return {
            projects: (result.projects ?? []).map((project: Record<string, any>) => ({
              id: project.id,
              name: project.name,
              framework: project.framework,
              production_domain: project.targets?.production?.url ?? null,
              updated_at: project.updatedAt ? new Date(project.updatedAt).toISOString() : null
            }))
          };
        }, abortSignal);
      }
    });
  }

  /* Off unless the install opts in. Read tools are always safe; these are not,
     so they are a separate switch rather than a scope on the same one. */
  if (resolvedGithubToken && githubWritesEnabled()) {
    Object.assign(tools, buildGitHubWriteTools({ token: resolvedGithubToken, onActivity }));
  }

  return tools;
}

/** For the setup notice: which developer connections are live. */
export function devToolAvailability(): { github: boolean; vercel: boolean; githubWrites: boolean } {
  return {
    github: Boolean(githubToken()),
    vercel: Boolean(vercelToken()),
    /* Reported separately: a read token and an opted-in write switch are two
       different states, and Settings must not imply the second from the first. */
    githubWrites: Boolean(githubToken()) && githubWritesEnabled()
  };
}
