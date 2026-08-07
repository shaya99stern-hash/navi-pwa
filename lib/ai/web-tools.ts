import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { isPrivateHostname } from "../mcp";
import { cacheSearch, readCachedSearch, recordSearch, searchAllowed } from "./search-budget";

/** Enough context to answer from, without swamping the prompt. */
const MAX_RESULTS = 6;
const MAX_PAGE_CHARS = 20_000;
const MAX_SNIPPET_CHARS = 1_200;
const REQUEST_TIMEOUT_MS = 12_000;
/** Transcripts and PDFs are the thing being asked about, so they get more room. */
const MAX_DOCUMENT_FETCH_CHARS = 32_000;

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

/** Crude but dependency-free: models read prose fine, they just cannot read markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\b[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?--!?>/g, " ")
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
async function fetchYouTubeTranscript(videoId: string, signal: AbortSignal): Promise<string | null> {
  const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0 (compatible; NaviOSHub/1.0)" },
    signal
  });
  if (!page.ok) return null;
  const html = await page.text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/ - YouTube$/, "").trim() ?? "";

  const tracksMatch = /"captionTracks":(\[.*?\])/.exec(html);
  if (!tracksMatch) return null;
  let tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
  try { tracks = JSON.parse(tracksMatch[1]); } catch { return null; }
  const track = tracks.find((entry) => entry.languageCode?.startsWith("en") && entry.kind !== "asr")
    ?? tracks.find((entry) => entry.languageCode?.startsWith("en"))
    ?? tracks.find((entry) => entry.kind !== "asr")
    ?? tracks[0];
  if (!track?.baseUrl) return null;

  const response = await fetch(`${track.baseUrl}&fmt=json3`, { signal });
  if (!response.ok) return null;
  const data = (await response.json()) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
  const text = (data.events ?? [])
    .flatMap((event) => (event.segs ?? []).map((seg) => seg.utf8 ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const clipped = text.length > MAX_DOCUMENT_FETCH_CHARS
    ? `${text.slice(0, MAX_DOCUMENT_FETCH_CHARS)}\n\n[Transcript truncated at ${MAX_DOCUMENT_FETCH_CHARS} characters.]`
    : text;
  return `Transcript of YouTube video${title ? ` “${title}”` : ""} (${videoId}):\n\n${clipped}`;
}

/** A model-supplied URL is untrusted input aimed at our own network. */
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
export function buildWebTools({ search, signal, onActivity = () => {} }: {
  search: boolean;
  signal?: AbortSignal;
  /** Announces work as it starts, so a pause in the stream has a visible reason. */
  onActivity?: (label: string) => void;
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
        try {
          const target = assertFetchableUrl(url);

          const videoId = youTubeVideoId(target);
          if (videoId) {
            onActivity("Reading the video transcript");
            const transcript = await withTimeout((inner) => fetchYouTubeTranscript(videoId, inner), signal);
            return transcript ?? "That video has no caption track, so there is no transcript to read. Say so rather than guessing at its contents.";
          }

          onActivity(`Reading ${target.hostname}`);
          return await withTimeout(async (inner) => {
            const response = await fetch(target, {
              headers: { Accept: "text/html,application/pdf,text/plain,application/json;q=0.9", "User-Agent": "NaviOSHub/1.0" },
              redirect: "follow",
              signal: inner
            });
            if (!response.ok) return `That page returned ${response.status}.`;
            const type = response.headers.get("content-type") ?? "";

            if (/application\/pdf/i.test(type) || /\.pdf$/i.test(target.pathname)) {
              const { extractPdfText } = await import("./document-text");
              const extracted = await extractPdfText(new Uint8Array(await response.arrayBuffer()));
              if (!extracted) return "That PDF has no text layer to extract — it is likely a scan.";
              const clipped = extracted.text.length > MAX_DOCUMENT_FETCH_CHARS
                ? `${extracted.text.slice(0, MAX_DOCUMENT_FETCH_CHARS)}\n\n[Truncated at ${MAX_DOCUMENT_FETCH_CHARS} characters.]`
                : extracted.text;
              return `PDF${extracted.pages ? ` (${extracted.pages} pages)` : ""}:\n\n${clipped}`;
            }

            if (!/text\/|json|xml/i.test(type)) return `That URL is ${type || "a binary file"}, which cannot be read as text.`;
            const body = await response.text();
            const text = /html/i.test(type) ? htmlToText(body) : body.trim();
            return text.length > MAX_PAGE_CHARS
              ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Truncated at ${MAX_PAGE_CHARS} characters.]`
              : text || "That page had no readable text.";
          }, signal);
        } catch (error) {
          // Returned, not thrown: a bad link should not end the whole response.
          return `Could not read that page: ${error instanceof Error ? error.message : "unknown error"}`;
        }
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
           and NaviSoul answers from its own knowledge. The refusal is written
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
