import { assertFetchableUrl, fetchRevalidating, readCapped } from "../web-tools";
import { parseOpenApi, SPEC_PATHS } from "./openapi";
import type { CapabilityManifest } from "./manifest";

/**
 * Finding out what an API can do, from the API.
 *
 * The parser handles a document that is already in hand; this is the part that
 * goes and gets one. It matters more than it looks, because the whole promise —
 * paste a base URL and a key, and Navi Soul knows what to do with it — rests on
 * not asking the person to find their API's spec themselves. Most of them do not
 * know whether it has one.
 *
 * ## Guessing, bounded
 *
 * Nothing standardises where a spec lives. Conventions are strong enough that a
 * short list of guesses finds one for a large share of APIs, and each guess is
 * one cheap request against a host the person just chose to add. So it tries
 * them in order and stops at the first that parses.
 *
 * What it must not become is a scanner. The list is fixed, short, and made of
 * paths that only ever hold documentation — never anything that reads like
 * probing for admin endpoints against somebody else's server.
 *
 * ## The same posture as every other fetch here
 *
 * https only, no private or link-local host, every redirect hop re-validated,
 * a hard byte ceiling applied mid-download, and a per-attempt timeout. Those
 * guards are imported rather than reimplemented: a second fetcher with its own
 * idea of what is safe is exactly the shape of bug this codebase keeps finding,
 * and the redirect check in particular exists because a public host answering
 * 302 toward an internal address is the classic way past a hostname guard.
 */

/** A spec larger than this is a document nobody is going to hold in a prompt. */
const MAX_SPEC_BYTES = 2_000_000;
/** Per attempt. Eight guesses that each hang for thirty seconds is a dead turn. */
const ATTEMPT_TIMEOUT_MS = 8_000;

export type SpecAttempt = {
  url: string;
  /** What happened, in a few words, for the person watching it try. */
  outcome: string;
};

export type DiscoveryResult =
  | { ok: true; manifest: CapabilityManifest; specUrl: string; attempts: SpecAttempt[] }
  | { ok: false; reason: string; attempts: SpecAttempt[] };

/** Candidate spec addresses for a base URL, most conventional first. */
export function specCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, "");
  let origin = trimmed;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    return [];
  }

  const candidates: string[] = [];
  /* A URL that already names a document is the person's own answer about where
     the spec is, and it beats every guess. */
  if (/\.(json|ya?ml)$/i.test(trimmed) || /openapi|swagger|api-docs/i.test(trimmed)) candidates.push(trimmed);

  for (const path of SPEC_PATHS) {
    /* Relative to the base they gave *and* to the bare origin, because an API
       rooted at `/v2` commonly documents itself at `/v2/openapi.json` and just
       as commonly at `/openapi.json`. */
    candidates.push(`${trimmed}${path}`);
    if (origin !== trimmed) candidates.push(`${origin}${path}`);
  }

  return [...new Set(candidates)];
}

async function fetchSpec(url: string, outer?: AbortSignal): Promise<
  { ok: true; document: unknown } | { ok: false; outcome: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward);

  try {
    const target = assertFetchableUrl(url);
    const hop = await fetchRevalidating(target, controller.signal);
    if ("blocked" in hop) return { ok: false, outcome: hop.blocked };
    if (!hop.response.ok) return { ok: false, outcome: `${hop.response.status}` };

    const { bytes, truncated } = await readCapped(hop.response, MAX_SPEC_BYTES);
    if (truncated) return { ok: false, outcome: "larger than the spec size limit" };

    const text = new TextDecoder().decode(bytes).trim();
    if (!text) return { ok: false, outcome: "empty" };

    try {
      return { ok: true, document: JSON.parse(text) };
    } catch {
      /* Worth telling apart rather than lumping in with "not found". A YAML
         spec means the API *does* describe itself and this app cannot read that
         form yet — which is a different thing to tell someone than "no spec",
         and usually has a JSON sibling one path away. */
      const looksLikeYaml = /^(openapi|swagger)\s*:/m.test(text);
      return { ok: false, outcome: looksLikeYaml ? "a YAML spec, which cannot be read yet" : "not JSON" };
    }
  } catch (error) {
    return { ok: false, outcome: error instanceof Error ? error.message : "unreachable" };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

/**
 * Try the conventional places until something parses as a spec.
 *
 * Every attempt is recorded, successful or not. A discovery that failed is the
 * moment someone most needs to know what was actually tried — "we could not
 * find a spec" with no list behind it is indistinguishable from not having
 * looked, and this app has shipped that shape of non-answer before.
 */
export async function discoverFromSpec(input: {
  baseUrl: string;
  id: string;
  name?: string;
  signal?: AbortSignal;
}): Promise<DiscoveryResult> {
  const candidates = specCandidates(input.baseUrl);
  if (!candidates.length) {
    return { ok: false, reason: "That is not a URL this app can fetch.", attempts: [] };
  }

  const attempts: SpecAttempt[] = [];

  for (const url of candidates) {
    if (input.signal?.aborted) break;
    const fetched = await fetchSpec(url, input.signal);
    if (!fetched.ok) {
      attempts.push({ url, outcome: fetched.outcome });
      continue;
    }

    const parsed = parseOpenApi({ document: fetched.document, specUrl: url, id: input.id, name: input.name });
    if (!parsed.ok) {
      /* JSON was served and it was not a spec. Common at `/api-docs`, which is
         as often a viewer page's data as it is the document itself. */
      attempts.push({ url, outcome: parsed.reason });
      continue;
    }

    attempts.push({ url, outcome: `read ${parsed.manifest.operations.length} operations` });
    return { ok: true, manifest: parsed.manifest, specUrl: url, attempts };
  }

  const yaml = attempts.find((attempt) => attempt.outcome.includes("YAML"));
  return {
    ok: false,
    /* The YAML case is called out because it is the one failure where the API
       does describe itself and the answer is "not yet" rather than "no". */
    reason: yaml
      ? `Found a spec at ${yaml.url}, but it is YAML and only JSON can be read so far. Many APIs serve the same document as JSON — try that address.`
      : "No OpenAPI document at any of the conventional addresses.",
    attempts
  };
}

/** Said plainly, for a person watching a discovery that did not work. */
export function describeAttempts(attempts: SpecAttempt[]): string {
  if (!attempts.length) return "Nothing was tried.";
  return attempts.map((attempt) => `- ${attempt.url} — ${attempt.outcome}`).join("\n");
}
