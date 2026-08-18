import { readCredential } from "./credentials";
import { PROVIDERS, PROVIDER_IDS, providerApiKey, modelsProbe } from "./provider-registry";
import type { CatalogEntry } from "./provider-catalog";

/**
 * Finding out whether a credential actually works, for every service — not just
 * the model providers.
 *
 * ## The report this exists to correct
 *
 * The owner said: *"I don't think that it actually has access to GitHub ... it
 * says also it's connected to GitHub. I don't think it really is."* They were
 * right, and the mechanism is worth naming precisely, because it is not a bug
 * in any one line.
 *
 * `inspect_environment` — the tool the system prompt names as the only
 * authority on what is configured, with an explicit instruction never to answer
 * from memory — rendered each service as `connected` or `not set`, from
 * `isEntryConfigured`, which tests whether an environment variable is a
 * non-empty string. A revoked token is a non-empty string. So is a token for
 * the wrong account, a token whose scopes were narrowed last month, and a
 * placeholder somebody pasted while setting the deployment up. All four read as
 * *connected*, permanently, and the model dutifully repeated it.
 *
 * `test_service` was supposed to be the answer to that. It could not be: it
 * resolved a service to a *model adapter* — `PROVIDER_IDS.find(id => id ===
 * entry.id)` — and GitHub, Vercel, Supabase, Tavily and Exa have none. Every
 * one of them fell through to "treat it as set but unverified". The tool whose
 * description promises to "actually call a connected service to find out
 * whether its key works" could verify exactly the services nobody doubts.
 *
 * ## What a probe is allowed to cost
 *
 * This deployment runs on free tiers on purpose, so a probe may not spend the
 * thing it is checking. Identity endpoints — `GET /user` — are free and
 * unmetered, which is why GitHub, Vercel and Supabase can be checked and Tavily
 * and Exa cannot: their only endpoint is the search itself, and a search spent
 * on a self-test is a search the owner cannot spend on an answer.
 *
 * "Not probeable, and here is the reason" is a real answer. "Set but
 * unverified" with no reason is the one this file was written to stop.
 *
 * ## Identity is the point, not a bonus
 *
 * A working token answers *whether*; the login on it answers *which account* —
 * and that second question is where the discrepancies live. An ambient
 * `GITHUB_TOKEN` injected by a build platform passes every check and belongs to
 * a bot; the owner would see "connected" and reasonably read it as their own
 * account. Returning the login turns an invisible mismatch into a sentence.
 *
 * Nothing here returns a credential. A login is a public name; a token is not,
 * and a token in a chat transcript is in every backup of that transcript.
 */

/** What a probe would do, decided without making any network call. */
export type ProbePlan =
  | {
    kind: "request";
    url: string;
    headers: Record<string, string>;
    /** Pulls the account name out of a successful body, when there is one. */
    identity?: (body: unknown) => string | null;
  }
  | { kind: "none"; why: string };

export type ProbeOutcome =
  /** The credential was used successfully. `identity` names the account. */
  | { kind: "working"; identity: string | null }
  /** The service understood the request and refused the credential. */
  | { kind: "rejected"; detail: string }
  /** The credential is fine; the service is rate limited right now. */
  | { kind: "limited"; detail: string }
  | { kind: "unreachable"; detail: string }
  /** No probe exists, for the stated reason. */
  | { kind: "unprobeable"; why: string };

/** GitHub rejects requests without one, so every call here carries it. */
const USER_AGENT = "NaviOS-Hub";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Which request identifies this service, if any.
 *
 * Pure and separate from making it, because *which* endpoint proves a
 * credential is a decision worth reading and testing on its own — and because
 * the reason a service cannot be probed is as much a part of the answer as a
 * status code.
 */
export function planProbe(entry: CatalogEntry): ProbePlan {
  /* Model providers first: they already have a listing endpoint, and it is the
     same one the routing layer probes, so a key that passes here is a key the
     router can use. */
  const adapter = PROVIDER_IDS.find((id) => id === entry.id);
  if (adapter) {
    const key = providerApiKey(PROVIDERS[adapter]);
    if (!key) return { kind: "none", why: `${entry.label} looked configured but no usable key resolved.` };
    const probe = modelsProbe(PROVIDERS[adapter], key);
    return { kind: "request", url: probe.url, headers: probe.headers };
  }

  switch (entry.id) {
    case "github-pat": {
      /* Resolved through the shared credential list rather than by reading
         `entry.envKey`, so this answers for the token the app would actually
         use. Reading the catalogue's single variable name is how the four
         disagreeing GitHub resolvers happened; see `credentials.ts`. */
      const token = readCredential("github");
      if (!token) return { kind: "none", why: "No GitHub token is set." };
      return {
        kind: "request",
        url: "https://api.github.com/user",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT
        },
        /* The account the token belongs to. An ambient token injected by a
           build platform answers with a bot name here, which is the difference
           between "connected" and "connected as someone you did not choose". */
        identity: (body) => text((body as { login?: unknown } | null)?.login)
      };
    }

    case "vercel": {
      const token = readCredential("vercel");
      if (!token) return { kind: "none", why: "No Vercel token is set." };
      return {
        kind: "request",
        url: "https://api.vercel.com/v2/user",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
        identity: (body) => {
          const user = (body as { user?: { username?: unknown; email?: unknown } } | null)?.user;
          return text(user?.username) ?? text(user?.email);
        }
      };
    }

    /* One connection described by two catalogue rows, so either row probes the
       pair. Half a Supabase configuration is not a working one, and saying
       which half is missing is the whole value of checking. */
    case "supabase-url":
    case "supabase-key": {
      const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
      const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
      if (!url) return { kind: "none", why: "NEXT_PUBLIC_SUPABASE_URL is not set, so there is nothing to call." };
      if (!key) return { kind: "none", why: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set, so a call would be unauthenticated." };
      if (!/^https:\/\//i.test(url)) return { kind: "none", why: "NEXT_PUBLIC_SUPABASE_URL is not an https address." };
      /* The REST root answers with the schema and needs no table to exist, so
         this checks the project and the key without assuming a migration has
         been run. */
      return { kind: "request", url: `${url}/rest/v1/`, headers: { apikey: key, Authorization: `Bearer ${key}` } };
    }

    /* A switch, not a credential. There is no endpoint that can confirm a
       boolean, and pretending to check one would be the same category of lie
       this file exists to remove. */
    case "github-writes":
      return {
        kind: "none",
        why: "This is a yes/no setting rather than a key, so there is nothing to call. It is on when NAVI_GITHUB_ALLOW_WRITES is set, and it only takes effect alongside a working GitHub token."
      };

    default:
      /* Search providers land here. Their only endpoint is the search itself,
         which is metered — so a self-test would spend the free allowance it is
         reporting on. */
      if (entry.kind === "search") {
        return {
          kind: "none",
          why: `${entry.label} bills every request, and its only endpoint is the search itself — testing it would spend one of the free searches it is being checked for. It reports as working or failing the first time a search actually runs.`
        };
      }
      return { kind: "none", why: `${entry.label} has no free endpoint that proves a key without spending quota.` };
  }
}

/**
 * Make the request the plan describes and say what came back.
 *
 * Never throws: a failed self-check must read as a failed self-check, not as a
 * broken turn. The distinction between *rejected* and *unreachable* is load
 * bearing — one means the key is wrong and the other means the network was, and
 * telling someone to replace a working key is its own kind of wrong answer.
 */
export async function runProbe(plan: ProbePlan, signal?: AbortSignal): Promise<ProbeOutcome> {
  if (plan.kind === "none") return { kind: "unprobeable", why: plan.why };

  try {
    const response = await fetch(plan.url, { headers: plan.headers, cache: "no-store", signal });

    if (response.status === 401 || response.status === 403) {
      return { kind: "rejected", detail: `answered ${response.status} — the credential is expired, revoked, or lacks the needed permission` };
    }
    if (response.status === 429) return { kind: "limited", detail: "is working but rate limited right now" };
    if (!response.ok) return { kind: "unreachable", detail: `answered ${response.status}` };

    if (!plan.identity) return { kind: "working", identity: null };
    /* A body that will not parse after a 200 is still a working credential —
       the service accepted it. Identity is the bonus, not the verdict. */
    const body = await response.json().catch(() => null);
    return { kind: "working", identity: plan.identity(body) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { kind: "unreachable", detail: aborted ? "timed out" : "could not be reached" };
  }
}

/** One sentence a person can act on, for each outcome. */
export function describeProbe(entry: CatalogEntry, outcome: ProbeOutcome): string {
  switch (outcome.kind) {
    case "working":
      return outcome.identity
        ? `${entry.label} answered normally. The key works, and it belongs to \`${outcome.identity}\` — say that account name when reporting this, because a working key for the wrong account is the failure that looks most like success.`
        : `${entry.label} answered normally. The key works.`;
    case "rejected":
      return `${entry.label} ${outcome.detail}. A new key: ${entry.keyUrl}`;
    case "limited":
      return `${entry.label} ${outcome.detail}.`;
    case "unreachable":
      return `${entry.label} ${outcome.detail}.`;
    case "unprobeable":
      return `${entry.label}: ${outcome.why}`;
  }
}
