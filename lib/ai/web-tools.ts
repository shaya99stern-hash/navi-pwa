import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { isPrivateHostname } from "../mcp";

/** Enough context to answer from, without swamping the prompt. */
const MAX_RESULTS = 6;
const MAX_PAGE_CHARS = 12_000;
const MAX_SNIPPET_CHARS = 1_200;
const REQUEST_TIMEOUT_MS = 12_000;

type SearchHit = { title: string; url: string; snippet: string };

/**
 * Whichever search provider has a key wins, so adding any one of them switches
 * the tool on with no code change. Ordered by how well the results suit a
 * model: Tavily returns extracted prose, Exa returns page text, Brave returns
 * short descriptions.
 */
function searchProvider(): "tavily" | "exa" | "brave" | null {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.EXA_API_KEY) return "exa";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
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

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(MAX_RESULTS));
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": String(process.env.BRAVE_SEARCH_API_KEY) },
      signal: inner
    });
    if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
    const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    return (data.web?.results ?? []).slice(0, MAX_RESULTS).map((hit) => ({
      title: clip(hit.title, 200), url: String(hit.url ?? ""), snippet: clip(hit.description, MAX_SNIPPET_CHARS)
    }));
  }, signal);
}

/** Crude but dependency-free: models read prose fine, they just cannot read markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
      description: "Fetch an https page and return its readable text. Use it to read a search result, or any link the user gives you, rather than guessing at its contents.",
      inputSchema: z.object({ url: z.string().describe("The full https URL to read.") }),
      execute: async ({ url }) => {
        try {
          const target = assertFetchableUrl(url);
          onActivity(`Reading ${target.hostname}`);
          return await withTimeout(async (inner) => {
            const response = await fetch(target, {
              headers: { Accept: "text/html,text/plain,application/json;q=0.9", "User-Agent": "NaviOSHub/1.0" },
              redirect: "follow",
              signal: inner
            });
            if (!response.ok) return `That page returned ${response.status}.`;
            const type = response.headers.get("content-type") ?? "";
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
        try {
          onActivity(`Searching for “${query}”`);
          const hits = await runSearch(query, signal);
          if (!hits.length) return `No results for "${query}".`;
          return hits
            .map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
            .join("\n\n");
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    });
  }

  return tools;
}
