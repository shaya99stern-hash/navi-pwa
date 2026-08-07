import { numberEnvironment, readCatalogCache, timeoutSignal, writeCatalogCache } from "./catalog";
import { terms } from "../memory";

/**
 * Finding the right files before answering, rather than hoping the model asks.
 *
 * The read tools already exist, and a model that uses them well ends up with
 * the right context. The gap is that weaker models do not use them well — they
 * answer from the shape of the question instead of going to look, and the
 * answer is confidently about a file nobody read.
 *
 * A mid-tier model given the exact three relevant files beats a frontier model
 * given the wrong ones. So when the repository is knowable, the files are
 * fetched and handed over before generation starts.
 *
 * ## Precision over recall, deliberately
 *
 * Three to five files, never thirty. Irrelevant context does not sit harmlessly
 * in the prompt — it actively degrades the answer by giving the model more
 * plausible-looking material to reason from than the question needs. The
 * temptation to widen the net is the thing to resist.
 *
 * ## One tokenizer
 *
 * Scoring reuses `terms` from `lib/memory.ts`, which already decides what
 * counts as a discriminating word. A second tokenizer written for this file
 * would drift from the first and nobody would notice until the two disagreed.
 */

/** The ceiling from the spec. Recall past this point costs more than it buys. */
const MAX_FILES = 5;
/** Below this a "match" is coincidence rather than relevance. */
const MIN_SCORE = 1.5;
/** Trees are large and change slowly; a session-length cache is right. */
const TREE_TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 6_000;
/** Enough of a file to reason about, without swamping the prompt. */
const MAX_FILE_CHARS = 12_000;
/** A tree past this size is a monorepo; ranking still works, fetching all does not. */
const MAX_TREE_ENTRIES = 12_000;

/** Paths that are never the answer to "why is this broken". */
const NOISE = /(^|\/)(node_modules|\.next|dist|build|out|coverage|vendor|\.git)\//i;
const NOISE_FILE = /\.(lock|map|min\.js|min\.css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp[34]|zip|pdf)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i;
const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type RepoRef = { owner: string; repo: string };

function normalizeRepoRef(repo: RepoRef): RepoRef | null {
  const owner = repo.owner.trim();
  const normalizedRepo = repo.repo.trim().replace(/\.git$/i, "");
  if (!GITHUB_OWNER_RE.test(owner)) return null;
  if (!GITHUB_REPO_RE.test(normalizedRepo)) return null;
  return { owner, repo: normalizedRepo };
}

/**
 * Which repository this request is about, if it says.
 *
 * Deliberately conservative: retrieval only front-runs the model when the
 * repository is unambiguous. When it is not, the read tools still work and the
 * model asks for what it needs — a worse path, but an honest one. Guessing a
 * repository and silently loading the wrong codebase is far worse than not
 * guessing.
 */
export function detectRepo(text: string): RepoRef | null {
  const url = /github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/.exec(text);
  if (url) return { owner: url[1], repo: url[2].replace(/\.git$/, "") };

  /* A bare `owner/repo`. Requires both halves to look like real segments and
     rejects anything that reads as a path fragment or a date. */
  const bare = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9._-]{0,38})\/([A-Za-z][A-Za-z0-9._-]{0,38})(?=$|[\s,.;:!?)])/.exec(text);
  if (!bare) return null;
  if (/^\d+$/.test(bare[1]) || /\.(ts|tsx|js|jsx|py|md|json|css)$/i.test(bare[2])) return null;
  return { owner: bare[1], repo: bare[2] };
}

type TreeEntry = { path: string; type: string };

async function githubJson<T>(token: string, path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "NaviOS",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return await response.json() as T;
}

/**
 * The repository's file list, fetched once and kept.
 *
 * One recursive call rather than walking directories: a tree of ten thousand
 * entries is a single request, where walking it is hundreds. The cache means a
 * follow-up question in the same conversation costs nothing.
 */
export async function fetchTree(options: {
  token: string;
  repo: RepoRef;
  signal: AbortSignal;
}): Promise<string[]> {
  const { token, repo, signal } = options;
  const slug = `${repo.owner}/${repo.repo}`;
  const key = `navi:tree:${slug}`;

  const cached = readCatalogCache<string[]>(key);
  if (cached?.fresh) return cached.value;

  const timed = timeoutSignal(signal, FETCH_TIMEOUT_MS, "Repository tree lookup timed out.");
  try {
    const meta = await githubJson<{ default_branch?: string }>(token, `/repos/${slug}`, timed.signal);
    const branch = meta.default_branch ?? "main";
    const tree = await githubJson<{ tree?: TreeEntry[] }>(
      token,
      `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      timed.signal
    );

    const paths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path)
      .filter((path) => !NOISE.test(path) && !NOISE_FILE.test(path) && !LOCKFILE.test(path))
      .slice(0, MAX_TREE_ENTRIES);

    writeCatalogCache(key, paths, numberEnvironment("NAVI_TREE_TTL_MS", TREE_TTL_MS, 60_000, 60 * 60_000));
    return paths;
  } catch (error) {
    console.warn("NaviSoul could not read the repository tree:", error);
    /* An expired tree still describes the repository better than nothing. */
    return cached?.value ?? [];
  } finally {
    timed.dispose();
  }
}

/**
 * Score a path against the request.
 *
 * Path and filename first, as the spec orders, and for a good reason: a file
 * called `composer-dock.tsx` is a far stronger signal for "fix the composer"
 * than the word "composer" appearing once inside some other file. The filename
 * is the author's own summary of what the file is.
 */
export function scorePath(path: string, queryTerms: string[]): number {
  if (!queryTerms.length) return 0;
  const lower = path.toLowerCase();
  const fileName = lower.slice(lower.lastIndexOf("/") + 1);
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
  const segments = new Set(terms(lower.replace(/[/.\-_]/g, " ")));

  let score = 0;
  for (const term of queryTerms) {
    // The filename itself is the strongest signal available.
    if (stem === term) score += 4;
    else if (fileName.includes(term)) score += 2.5;
    else if (segments.has(term)) score += 1.5;
    else if (lower.includes(term)) score += 0.75;
  }

  /* A shallow path is more likely to be the thing itself rather than a test
     fixture or an example of it. Small nudge, not a rule. */
  const depth = path.split("/").length;
  if (depth <= 2) score += 0.3;
  if (/(^|\/)(test|tests|__tests__|spec|fixtures?|examples?)\//i.test(path)) score -= 1;

  return score;
}

export type RankedFile = { path: string; score: number };

export function rankFiles(paths: string[], request: string, limit = MAX_FILES): RankedFile[] {
  const queryTerms = Array.from(new Set(terms(request)));
  if (!queryTerms.length) return [];

  return paths
    .map((path) => ({ path, score: scorePath(path, queryTerms) }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit);
}

async function fetchFile(token: string, repo: RepoRef, path: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        headers: {
          Accept: "application/vnd.github.raw",
          Authorization: `Bearer ${token}`,
          "User-Agent": "NaviOS",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store",
        signal
      }
    );
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n… file truncated.` : text;
  } catch {
    return null;
  }
}

export type Retrieval = { paths: string[]; block: string };

/**
 * Fetch the highest-ranked files and render them for the prompt.
 *
 * Returns null rather than throwing on every failure path. Retrieval is an
 * optimisation on top of tools that already work; when it cannot run, the model
 * asks for what it needs and the answer is slower rather than absent.
 */
export async function retrieveFiles(options: {
  token: string;
  repo: RepoRef;
  request: string;
  signal: AbortSignal;
}): Promise<Retrieval | null> {
  const { token, repo, request, signal } = options;
  const normalizedRepo = normalizeRepoRef(repo);
  if (!normalizedRepo) return null;

  const paths = await fetchTree({ token, repo: normalizedRepo, signal });
  if (!paths.length) return null;

  const ranked = rankFiles(paths, request);
  if (!ranked.length) return null;

  const timed = timeoutSignal(signal, FETCH_TIMEOUT_MS, "Repository file read timed out.");
  try {
    const files = await Promise.all(
      ranked.map(async (entry) => ({ path: entry.path, content: await fetchFile(token, normalizedRepo, entry.path, timed.signal) }))
    );
    const found = files.filter((file): file is { path: string; content: string } => Boolean(file.content));
    if (!found.length) return null;

    return {
      paths: found.map((file) => file.path),
      block: [
        `## Files read from ${normalizedRepo.owner}/${normalizedRepo.repo}`,
        "",
        "These are the current contents. Reason from them rather than from memory, and do not describe code that is not here.",
        "Before answering, say in one line which files you read.",
        "",
        ...found.map((file) => `--- ${file.path} ---\n${file.content}`)
      ].join("\n")
    };
  } finally {
    timed.dispose();
  }
}
