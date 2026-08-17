/**
 * Turning a fetched page into something worth reasoning over.
 *
 * The extractor this replaces was a fixed chain of replacements whose own
 * comment called it "crude but dependency-free". It was both, and the crude
 * half cost more than the comment implied:
 *
 *  - `<[^>]+>` → " " deleted every tag, and with them **every href**. A model
 *    reading the output could see that a page mentioned something and had no
 *    way to find where it linked. Multi-hop crawling was blind by
 *    construction: hop one could never learn the address of hop two.
 *  - Navigation, headers, footers, cookie banners and sidebars all survived as
 *    prose, so a 20,000-character budget was spent largely on menu items.
 *  - Six named entities were decoded and no numeric ones, so `&#8212;` and
 *    `&#x27;` reached the model raw.
 *  - Tables flattened into an undifferentiated run of words, which is the one
 *    shape where losing structure loses the content itself.
 *
 * Still dependency-free, and that is a constraint rather than a preference:
 * this runs in the edge runtime, which has no DOM. `@mozilla/readability` needs
 * a `document`; `jsdom` needs Node internals. Pure-JS parsers exist but the
 * bundle limit here is small and the cold start is on the request path.
 *
 * So this is structural rather than statistical. It does not score paragraphs
 * by text density the way Readability does — it removes what is definitely not
 * content, preserves the structure that carries meaning, and leaves the
 * judgement to the model. Being wrong costs a few lines of menu text, never a
 * silently dropped article.
 */

/** Elements whose contents are never page content. Removed whole. */
const DISCARDED = ["script", "style", "noscript", "svg", "iframe", "template", "head", "form", "dialog", "canvas"];

/**
 * Semantic containers that hold site furniture rather than the page's subject.
 *
 * Only the four HTML5 landmarks with unambiguous meaning. `<div class="nav">`
 * is deliberately not in here: matching containers by class without a parser
 * means guessing where the matching `</div>` is, and guessing wrong deletes the
 * article. Those are handled after conversion, as lines, where a mistake costs
 * one line instead of the body.
 */
const FURNITURE = ["nav", "header", "footer", "aside"];

/**
 * Remove every occurrence of an element, including its children, handling the
 * case where one is nested inside another of the same name.
 *
 * A non-greedy `<tag>.*?</tag>` closes at the *first* end tag, which for nested
 * elements ends the match early and leaves a stray `</tag>` behind — and for a
 * `<nav>` containing a `<nav>` it leaves half the menu in the output. Counting
 * depth costs a short scan and removes that whole class of error.
 */
function dropElement(html: string, tag: string): string {
  const open = new RegExp(`<${tag}(?=[\\s/>])[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let out = "";
  let cursor = 0;

  for (;;) {
    open.lastIndex = cursor;
    const start = open.exec(html);
    if (!start) break;
    /* A self-closing or void form has no body to remove. */
    if (start[0].endsWith("/>")) {
      out += html.slice(cursor, start.index);
      cursor = start.index + start[0].length;
      continue;
    }

    out += html.slice(cursor, start.index);
    let depth = 1;
    let scan = start.index + start[0].length;

    while (depth > 0) {
      open.lastIndex = scan;
      close.lastIndex = scan;
      const nextOpen = open.exec(html);
      const nextClose = close.exec(html);
      if (!nextClose) { scan = html.length; break; }
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth += 1;
        scan = nextOpen.index + nextOpen[0].length;
      } else {
        depth -= 1;
        scan = nextClose.index + nextClose[0].length;
      }
    }
    cursor = scan;
  }

  return out + html.slice(cursor);
}

/**
 * HTML entities, including the numeric forms the old chain ignored.
 *
 * Ordered so `&amp;` is decoded last: doing it first turns `&amp;lt;` — an
 * escaped, literal `&lt;` — into a working `<`, which is both wrong and a way
 * to smuggle markup past a sanitiser.
 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "“", rdquo: "”",
    lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", hellip: "…",
    middot: "·", bull: "•", trade: "™", copy: "©", reg: "®",
    deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢", times: "×"
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[String(name).toLowerCase()] ?? whole)
    .replace(/&amp;/gi, "&");
}

function codePoint(value: number): string {
  /* Out-of-range or malformed numeric entities are left as a space rather than
     throwing — a bad entity is a typo on someone else's page, not a reason to
     lose the document. */
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return " ";
  try { return String.fromCodePoint(value); } catch { return " "; }
}

/** Absolute form of a link, so a model can actually fetch what it reads. */
function resolveHref(href: string, base?: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) return null;
  if (!base) return /^https?:\/\//i.test(raw) ? raw : null;
  try { return new URL(raw, base).toString(); } catch { return null; }
}

/**
 * Lines that are site furniture wherever they appear.
 *
 * Applied after conversion, per line, precisely because it is a heuristic. A
 * wrong guess here drops one line; the same guess applied to a container would
 * drop everything inside it.
 */
const FURNITURE_LINE = /^(?:skip to (?:main|content)|menu|search|sign in|sign up|log ?in|subscribe|newsletter|accept(?: all)?(?: cookies)?|cookie(?: policy| settings)?|privacy policy|terms(?: of (?:use|service))?|all rights reserved|share(?: this)?|follow us|back to top|©.*)$/i;

export type ReadableOptions = {
  /** The page's own URL, so relative links resolve to fetchable addresses. */
  baseUrl?: string;
};

/**
 * A page as structured markdown-ish text.
 *
 * Headings, lists, tables and links are preserved because each carries meaning
 * the prose does not: a heading says what a section is about, a table's rows
 * are its content, and a link is the only way the next hop can be found.
 */
export function extractReadable(html: string, options: ReadableOptions = {}): string {
  let working = html;

  working = working.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DISCARDED) working = dropElement(working, tag);
  for (const tag of FURNITURE) working = dropElement(working, tag);

  /* Links first, while the markup that carries the href still exists. The old
     chain deleted tags before it could ever have read one. */
  working = working.replace(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
    (whole, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) return " ";
      const target = resolveHref(href, options.baseUrl);
      return target ? ` [${text}](${target}) ` : ` ${text} `;
    }
  );

  /* Structure, marked before the remaining tags are stripped. */
  working = working
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
      (_, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, " ").trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    /* Cells become pipe-separated and rows become lines, so a table stays a
       grid. Flattened into prose, a rate table is unreadable — and rate tables
       are exactly the artefact worth fetching. */
    .replace(/<\/t[dh]\s*>\s*<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<t[dh]\b[^>]*>/gi, "")
    .replace(/<\/t[dh]\s*>/gi, "")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|blockquote|pre|tr|table|ul|ol|dl|dd|dt|figcaption)\s*>/gi, "\n");

  working = working.replace(/<[^>]+>/g, " ");
  working = decodeEntities(working);

  const lines = working
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line && !FURNITURE_LINE.test(line));

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[-\s]+$/gm, "")
    .trim();
}
