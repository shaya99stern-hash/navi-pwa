import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { isPrivateHostname } from "../mcp";
import { extractReadable } from "./readable";
import { cacheSearch, readCachedSearch, recordSearch, searchAllowed } from "./search-budget";

/** Enough context to answer from, without swamping the prompt. */
const MAX_RESULTS = 6;
const MAX_PAGE_CHARS = 20_000;
const MAX_SNIPPET_CHARS = 1_200;
const REQUEST_TIMEOUT_MS = 12_000;
/** Transcripts and PDFs are the thing being asked about, so they get more room. */
const MAX_DOCUMENT_FETCH_CHARS = 32_000;
/**
 * Hard ceiling on a download, applied while it streams.
 *
 * The character caps above only ever trimmed something already fully in
 * memory, because `.text()` and `.arrayBuffer()` buffer the whole body first —
 * so how much this isolate downloaded was the remote host's decision, not ours.
 */
const MAX_DOCUMENT_BYTES = 4_000_000;
/** Redirect hops followed, each re-validated, before giving up. */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/**
 * Named honestly rather than as a browser.
 *
 * Some hosts serve a bot-check page to this, and a browser string would get
 * past a few of them. It would also be a lie told at scale to every site the
 * app reads, which is a poor trade for a marginally better hit rate — and the
 * failure is already reported honestly rather than as an empty page.
 */
const USER_AGENT = "NaviOSHub/1.0";

type SearchHit = { title: string; url: string; snippet: string };

/**
 * Whichever search provider has a key wins, so adding any one of them switches
 * the tool on with no code change. Ordered by how well the results suit a
 * model: Tavily returns extracted prose, Exa returns page text, Brave returns
 * short descriptions.
 */
/**
 * Whichever search provider has a key wins.
 *
 * Brave was here and is deliberately gone. Its perpetual free tier was retired
 * in February 2026 — a new account gets a one-time credit and a card on file
 * with no spend cap, which turns "just add a key" into a way to start billing
 * without noticing. A provider that cannot fail closed does not belong in an
 * app whose whole premise is free tiers.
 */
function searchProvider(): "tavily" | "exa" | null {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.EXA_API_KEY) return "exa";
  return null;
}

export function hasWebSearch(): boolean {
  return searchProvider() !== null;
}

/** Which provider is answering searches, for status surfaces. Never the key. */
export function searchProviderName(): string | null {
  return searchProvider();
}

function clip(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
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

async function runSearch(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const provider = searchProvider();
  if (!provider) return [];

  return withTimeout(async (inner) => {
    if (provider === "tavily") {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
        body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic" }),
        signal: inner
      });
      if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
      const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (data.results ?? []).slice(0, MAX_RESULTS).map((hit) => ({
        title: clip(hit.title, 200), url: String(hit.url ?? ""), snippet: clip(hit.content, MAX_SNIPPET_CHARS)
      }));
    }

    if (provider === "exa") {
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": String(process.env.EXA_API_KEY) },
        body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } } }),
        signal: inner
      });
      if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
      const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
      return (data.results ?? []).slice(0, MAX_RESULTS).map((hit) => ({
        title: clip(hit.title, 200), url: String(hit.url ?? ""), snippet: clip(hit.text, MAX_SNIPPET_CHARS)
      }));
    }

    throw new Error("No search provider is configured.");
  }, signal);
}

/**
 * A page as text a model can reason over.
 *
 * The implementation moved to `readable.ts`; this stays as the name the fetch
 * path calls. Passing the page's own URL is what lets relative links resolve
 * into addresses that can actually be fetched — without it, the second hop of
 * any crawl is a path with no host.
 */
export function htmlToText(html: string, baseUrl?: string): string {
  return extractReadable(html, { baseUrl });
}

/** The video id, when a URL is a YouTube watch page in any of its shapes. */
export function youTubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const path = /^\/(?:shorts|embed|live|v)\/([\w-]{6,20})/.exec(url.pathname);
    return path ? path[1] : null;
  }
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  return null;
}

/**
 * A video's transcript, straight from YouTube's own caption tracks.
 *
 * Sending a model the watch-page HTML answers nothing — the content of a video
 * is what is said in it. The caption track list is embedded in the page as
 * JSON; a human-written track is preferred over the auto-generated one, and
 * English over other languages, falling back gracefully. Null when the video
 * has no captions at all, which the caller reports rather than hides.
 */
/**
 * Why a transcript could not be read — as distinct from whether one exists.
 *
 * Every one of these used to be `null`, and the caller turned `null` into
 * "that video has no caption track". Five different failures, one confident
 * claim about the world, and the app said it three times in a row to someone
 * who was looking at the captions on their own screen.
 *
 * Only `no-captions` is a fact about the video. The rest are facts about *us*:
 * YouTube served a consent or bot-check page, the markup moved, the caption
 * list would not parse. Stating any of those as "this video has no subtitles"
 * is inventing a property of something we failed to look at — the same failure
 * as blaming Supabase for a write nobody could observe.
 */
type TranscriptFailure = "unreachable" | "no-caption-list" | "no-captions" | "empty";

async function fetchYouTubeTranscript(
  videoId: string,
  signal: AbortSignal
): Promise<{ text: string } | { failure: TranscriptFailure }> {
  const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0 (compatible; NaviOSHub/1.0)" },
    signal
  });
  if (!page.ok) return { failure: "unreachable" };
  const html = await page.text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/ - YouTube$/, "").trim() ?? "";

  const tracksMatch = /"captionTracks":(\[.*?\])/.exec(html);
  /* No caption list in the page is *not* the same as a video without captions.
     It is overwhelmingly the signal that we were served something other than
     the watch page. */
  if (!tracksMatch) return { failure: "no-caption-list" };
  let tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
  try { tracks = JSON.parse(tracksMatch[1]); } catch { return { failure: "no-caption-list" }; }
  /* Here — and only here — an empty list really does mean the video has none. */
  if (!tracks.length) return { failure: "no-captions" };
  const track = tracks.find((entry) => entry.languageCode?.startsWith("en") && entry.kind !== "asr")
    ?? tracks.find((entry) => entry.languageCode?.startsWith("en"))
    ?? tracks.find((entry) => entry.kind !== "asr")
    ?? tracks[0];
  if (!track?.baseUrl) return { failure: "no-captions" };

  const response = await fetch(`${track.baseUrl}&fmt=json3`, { signal });
  if (!response.ok) return { failure: "unreachable" };
  const data = (await response.json()) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
  const text = (data.events ?? [])
    .flatMap((event) => (event.segs ?? []).map((seg) => seg.utf8 ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { failure: "empty" };

  const clipped = text.length > MAX_DOCUMENT_FETCH_CHARS
    ? `${text.slice(0, MAX_DOCUMENT_FETCH_CHARS)}\n\n[Transcript truncated at ${MAX_DOCUMENT_FETCH_CHARS} characters.]`
    : text;
  return { text: `Transcript of YouTube video${title ? ` “${title}”` : ""} (${videoId}):\n\n${clipped}` };
}

/** One sentence per cause, and only one of them is about the video. */
const TRANSCRIPT_FAILURE_TEXT: Record<TranscriptFailure, string> = {
  unreachable: "YouTube did not return the video page, so the transcript could not be read. This is a failure to reach it, not a statement about the video — say exactly that in one sentence, and do not claim the video lacks captions.",
  "no-caption-list": "The page came back without a caption list, which usually means YouTube served a consent or bot-check page rather than the video. Say that the transcript could not be retrieved and that this is not evidence the video lacks subtitles. Offer once to work from a summary the user pastes; do not list alternatives at length.",
  "no-captions": "This video genuinely has no caption track — the caption list was returned and it was empty. Say so in one sentence.",
  empty: "The caption track was found but contained no text. Say the transcript came back empty; do not conclude the video has no captions."
};

/** A model-supplied URL is untrusted input aimed at our own network. */
/**
 * Follow redirects by hand, re-checking every hop against the SSRF guard.
 *
 * `assertFetchableUrl` validates the URL it is given and nothing after it, so
 * `redirect: "follow"` handed the decision to whoever answered: a public host
 * that returns 302 toward `169.254.169.254` is the textbook way past a hostname
 * check, and hop three of a crawl is an address nobody chose. `connector-tools.ts`
 * already refuses redirects outright for exactly this reason, and its comment
 * says so — the two fetchers disagreed, and this one was the permissive half.
 *
 * Refusing them here is not an option the way it is there: real pages redirect
 * constantly for http-to-https, trailing slashes and CDN edges, and a fetcher
 * that rejects a 301 cannot read the open web. So each hop is validated the
 * same way the first one was, and the chain is bounded.
 */
export async function fetchRevalidating(
  start: URL,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: URL } | { blocked: string }> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      headers: { Accept: "text/html,application/pdf,text/plain,application/json;q=0.9", "User-Agent": USER_AGENT },
      redirect: "manual",
      signal
    });

    if (!REDIRECT_STATUS.has(response.status)) return { response, finalUrl: current };

    const location = response.headers.get("location");
    /* A 3xx with nowhere to go is the server's answer, not a redirect. */
    if (!location) return { response, finalUrl: current };

    try {
      current = assertFetchableUrl(new URL(location, current).toString());
    } catch {
      /* Named as a redirect rather than as a bad link: the user's URL was
         fine, and the difference matters when they are looking at a page that
         loads perfectly in their own browser. */
      return { blocked: "That link redirected to an address that cannot be fetched." };
    }
  }

  return { blocked: `That link redirected more than ${MAX_REDIRECTS} times.` };
}

/**
 * Read a body with a hard byte ceiling, stopping mid-download rather than after.
 *
 * `.text()` and `.arrayBuffer()` buffer the whole response before any limit can
 * be applied, so the existing character caps only ever trimmed something
 * already fully in memory — an edge isolate has little of it, and the size of
 * the download was entirely the remote host's choice.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    return whole.byteLength > maxBytes
      ? { bytes: whole.slice(0, maxBytes), truncated: true }
      : { bytes: whole, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room));
        total += room;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    /* Releases the connection when the cap cut the read short. */
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, truncated };
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("Only https URLs can be fetched.");
  if (isPrivateHostname(url.hostname)) throw new Error("That address is not reachable.");
  return url;
}

/**
 * Tools that give the model access to the world and to an accurate clock.
 * Search appears only when the user has enabled it and a provider key is
 * configured; the rest need neither, so they work on every deployment
 * including a fully keyless one.
 */
/**
 * Read a link as text: the body of the `fetch_url` tool, lifted out so callers
 * that are not a model can use it.
 *
 * The learning loop needs exactly this — the same redirects, the same PDF
 * extraction, the same YouTube transcript path — and a second fetcher beside it
 * would be a second set of answers to "can this link be read", which is the
 * question the honest reply to "learn this video" depends on.
 *
 * Failures come back as text rather than thrown, because the caller is usually
 * a model and a bad link should not end a response.
 */
/**
 * Why a URL could not be read, as distinct from what it said.
 *
 * Only `no-captions` is a fact about the source. The rest are facts about this
 * request — the same distinction `TranscriptFailure` above draws, carried out
 * to every caller instead of stopping at the transcript.
 */
export type UrlReadFailure =
  | "blocked"
  | "unreachable"
  | "no-transcript"
  | "no-captions"
  | "unreadable"
  | "empty";

/**
 * The result of reading a URL, with failure kept out of the content channel.
 *
 * This used to be one `string`: the page text on success, an explanatory
 * sentence on failure. That reads fine when a model is the consumer — it can
 * tell prose about a page from the page — but it is indistinguishable to code,
 * and one caller is code. The learning loop asked for a URL, received
 * "The page came back without a caption list, which usually means YouTube
 * served a consent or bot-check page…", measured it at 319 characters, decided
 * that was enough content to be worth learning from, and fed the sentence to an
 * extraction model as the thing to extract lessons about. Those lessons were
 * then stored permanently and injected into every later prompt.
 *
 * A failure that is shaped like success will eventually be treated as success.
 * So failure gets its own shape, and the string form survives only as the
 * wrapper the model-facing tool needs.
 */
export type UrlReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: UrlReadFailure; guidance: string };

export async function readUrl(url: string, options: {
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
} = {}): Promise<UrlReadResult> {
  const onActivity = options.onActivity ?? (() => {});
  const signal = options.signal;
  const why = (error: unknown): string => (error instanceof Error ? error.message : "unknown error");

  /* Hoisted out of the fetch below so a URL we refuse to touch is reported as
     refused, rather than as a host that would not answer. */
  let target: URL;
  try {
    target = assertFetchableUrl(url);
  } catch (error) {
    return { ok: false, reason: "blocked", guidance: `Could not read that page: ${why(error)}` };
  }

  try {
    const videoId = youTubeVideoId(target);
    if (videoId) {
      onActivity("Reading the video transcript");
      const transcript = await withTimeout(
        (inner) => fetchYouTubeTranscript(videoId, inner),
        signal
      );
      if ("text" in transcript) return { ok: true, text: transcript.text };
      return {
        ok: false,
        reason: transcript.failure === "no-captions" ? "no-captions" : "no-transcript",
        guidance: TRANSCRIPT_FAILURE_TEXT[transcript.failure]
      };
    }

    onActivity(`Reading ${target.hostname}`);
    return await withTimeout(async (inner): Promise<UrlReadResult> => {
      const hop = await fetchRevalidating(target, inner);
      if ("blocked" in hop) return { ok: false, reason: "blocked", guidance: hop.blocked };
      const { response, finalUrl } = hop;
      if (!response.ok) return { ok: false, reason: "unreachable", guidance: `That page returned ${response.status}.` };
      const type = response.headers.get("content-type") ?? "";

      if (/application\/pdf/i.test(type) || /\.pdf$/i.test(finalUrl.pathname)) {
        const { extractPdfText } = await import("./document-text");
        const { bytes } = await readCapped(response, MAX_DOCUMENT_BYTES);
        const extracted = await extractPdfText(bytes);
        if (!extracted) return { ok: false, reason: "unreadable", guidance: "That PDF has no text layer to extract — it is likely a scan." };
        const clipped = extracted.text.length > MAX_DOCUMENT_FETCH_CHARS
          ? `${extracted.text.slice(0, MAX_DOCUMENT_FETCH_CHARS)}\n\n[Truncated at ${MAX_DOCUMENT_FETCH_CHARS} characters.]`
          : extracted.text;
        return { ok: true, text: `PDF${extracted.pages ? ` (${extracted.pages} pages)` : ""}:\n\n${clipped}` };
      }

      if (!/text\/|json|xml/i.test(type)) {
        return { ok: false, reason: "unreadable", guidance: `That URL is ${type || "a binary file"}, which cannot be read as text.` };
      }
      const { bytes } = await readCapped(response, MAX_DOCUMENT_BYTES);
      const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      /* The URL that actually served the body, not the one requested: redirects
         are followed, so relative links belong to the final host. Resolving
         them against the original would point every link at the wrong site. */
      const text = /html/i.test(type) ? htmlToText(body, finalUrl.toString()) : body.trim();
      if (!text) return { ok: false, reason: "empty", guidance: "That page had no readable text." };
      return {
        ok: true,
        text: text.length > MAX_PAGE_CHARS
          ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Truncated at ${MAX_PAGE_CHARS} characters.]`
          : text
      };
    }, signal);
  } catch (error) {
    // Returned, not thrown: a bad link should not end the whole response.
    return { ok: false, reason: "unreachable", guidance: `Could not read that page: ${why(error)}` };
  }
}

/**
 * The string-returning face of `readUrl`, for the model-facing `fetch_url`.
 *
 * A model reads the guidance and does the right thing with it, so this side of
 * the boundary is unchanged on purpose — every sentence it can return is the
 * one it returned before. Code should call `readUrl` instead.
 */
export async function readUrlAsText(url: string, options: {
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
} = {}): Promise<string> {
  const result = await readUrl(url, options);
  return result.ok ? result.text : result.guidance;
}

export function buildWebTools({ search, signal, onActivity = () => {}, onSource = () => {} }: {
  search: boolean;
  signal?: AbortSignal;
  /** Announces work as it starts, so a pause in the stream has a visible reason. */
  onActivity?: (label: string) => void;
  /**
   * Records a page that was genuinely retrieved, with the address it came from.
   *
   * The tool's return value goes to the model and nowhere else, so nothing
   * outside this call ever knew which pages were actually read — which made a
   * real citation and an invented one identical from the app's side. This is
   * the thread that lets a later pass tell them apart.
   *
   * Only successful reads are reported. A failure explains itself to the model
   * and must never become material an answer can be checked against.
   */
  onSource?: (source: { url: string; text: string }) => void;
}): ToolSet {
  const tools: ToolSet = {
    current_datetime: tool({
      description: "The current date and time. Call this for anything involving today, now, deadlines, ages, or elapsed time — you have no clock of your own and your training data is stale.",
      inputSchema: z.object({
        timeZone: z.string().optional().describe("IANA zone such as America/New_York. Defaults to UTC.")
      }),
      execute: async ({ timeZone }) => {
        onActivity("Checking the time");
        const now = new Date();
        try {
          const zone = timeZone || "UTC";
          return [
            `ISO (UTC): ${now.toISOString()}`,
            `Local (${zone}): ${new Intl.DateTimeFormat("en-US", {
              dateStyle: "full", timeStyle: "long", timeZone: zone
            }).format(now)}`
          ].join("\n");
        } catch {
          return `ISO (UTC): ${now.toISOString()}\n(Unknown time zone "${timeZone}", so only UTC is shown.)`;
        }
      }
    }),

    fetch_url: tool({
      description: "Fetch an https link and return its readable content. Handles web pages, plain text, JSON, PDFs (text is extracted), and YouTube links (the video's transcript is returned). Use it to read a search result or any link the user gives you, rather than guessing at its contents.",
      inputSchema: z.object({ url: z.string().describe("The full https URL to read.") }),
      execute: async ({ url }) => {
        const result = await readUrl(url, { signal, onActivity });
        /* Recorded before the string is handed back, and only on success: the
           model gets exactly the sentences it got before, while the turn keeps
           a record of what was really read. */
        if (result.ok) onSource({ url, text: result.text });
        return result.ok ? result.text : result.guidance;
      }
    })
  };

  if (search && hasWebSearch()) {
    tools.web_search = tool({
      description: "Search the web for current information. Use it for anything recent, factual, or that you are unsure of, then read the most promising result with fetch_url before answering.",
      inputSchema: z.object({ query: z.string().describe("What to search for.") }),
      execute: async ({ query }) => {
        /* Cache first. The same question asked twice within the hour is one
           call, not two, and near-repeats are most of what a chat generates —
           this is a larger saving than the ceiling below ever is. */
        const cached = readCachedSearch(query);
        if (cached) {
          onActivity(`Searching for “${query}”`);
          return cached;
        }

        /* Then the ceiling. Past 90% of the month's allotment the tool stops
           and Navi Soul answers from its own knowledge. The refusal is written
           for the model, not the user: it says what happened so the answer can
           be honest about not having looked, without turning into a notice
           about quotas that nobody asked for. */
        if (!(await searchAllowed())) {
          return "Web search is unavailable for the rest of this period. Answer from your own knowledge and say plainly that you could not check anything current.";
        }

        try {
          onActivity(`Searching for “${query}”`);
          const hits = await runSearch(query, signal);
          void recordSearch();
          if (!hits.length) return `No results for "${query}".`;
          const rendered = hits
            .map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
            .join("\n\n");
          cacheSearch(query, rendered);
          return rendered;
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    });
  }

  return tools;
}
