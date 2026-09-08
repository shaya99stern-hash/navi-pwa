import { tool } from "ai";
import { z } from "zod";
import { readUrl } from "./web-tools";

export function buildPublicDataTools(options: {
  signal?: AbortSignal;
  onSource?: (source: { url: string; text: string }) => void;
  onActivity?: (label: string) => void;
}) {
  return {
    scrape_pages: tool({
      description: "Read up to five public HTTPS pages, PDFs, or JSON endpoints and return source text for extraction into a table or report. No API key required. Does not execute page JavaScript, sign into websites, or crawl beyond the supplied URLs. Reports each failure separately.",
      inputSchema: z.object({ urls: z.array(z.string().url()).min(1).max(5) }),
      execute: async ({ urls }) => {
        const results = [];
        for (const url of [...new Set(urls)]) {
          if (options.signal?.aborted) break;
          const result = await readUrl(url, options);
          if (result.ok) options.onSource?.({ url, text: result.text });
          results.push({ url, ...result, ...(result.ok ? { text: result.text.slice(0, 10000) } : {}) });
        }
        return { pages: results, requested: urls.length, completed: results.length, cancelled: Boolean(options.signal?.aborted) };
      }
    }),
    nyc_property_records: tool({
      description: "Look up NYC ACRIS property document references by borough, block and lot using the same public source as Short Sale Lead Engine. Covers Manhattan, Bronx, Brooklyn and Queens. Staten Island uses Richmond County and is explicitly unavailable here. These are recorded-document references, not proof of current debt, distress, ownership, or short-sale eligibility.",
      inputSchema: z.object({ borough: z.number().int().min(1).max(5), block: z.number().int().min(1).max(99999), lot: z.number().int().min(1).max(9999) }),
      execute: async ({ borough, block, lot }) => {
        if (borough === 5) return { status: "unavailable", reason: "Staten Island requires the Richmond County Clerk source. It is not covered by this ACRIS lookup." };
        const url = new URL("https://data.cityofnewyork.us/resource/8h5j-fqxa.json");
        url.searchParams.set("$where", `borough=${borough} AND block=${block} AND lot=${lot}`);
        url.searchParams.set("$limit", "100");
        url.searchParams.set("$order", "document_id DESC");
        options.onActivity?.("Reading NYC property records");
        const result = await readUrl(url.toString(), options);
        if (result.ok) options.onSource?.({ url: url.toString(), text: result.text });
        return { source: "NYC ACRIS", sourceUrl: url.toString(), observedAt: new Date().toISOString(), coverage: "At most 100 document references; not a complete title or mortgage search.", ...result };
      }
    })
  };
}
