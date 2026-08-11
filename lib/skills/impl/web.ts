/** Web and HTTP utilities — the lookups a developer opens a tab for. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const STATUS: Record<string, string> = {
  "200": "OK — the request succeeded.",
  "201": "Created — a new resource exists; return its location.",
  "204": "No Content — succeeded, deliberately no body.",
  "301": "Moved Permanently — update the link; caches and search engines will.",
  "302": "Found — temporary redirect; the original URL stays canonical.",
  "304": "Not Modified — the cached copy is still good.",
  "307": "Temporary Redirect — like 302 but the method is preserved.",
  "308": "Permanent Redirect — like 301 but the method is preserved.",
  "400": "Bad Request — malformed; the client should not retry unchanged.",
  "401": "Unauthorized — actually means unauthenticated. No or bad credentials.",
  "403": "Forbidden — authenticated but not allowed. Re-authenticating will not help.",
  "404": "Not Found — no resource at this URL.",
  "405": "Method Not Allowed — the URL exists, this verb does not.",
  "409": "Conflict — the request clashes with current state.",
  "410": "Gone — deliberately removed, unlike 404.",
  "418": "I'm a teapot — an April Fools' joke from RFC 2324, still widely implemented.",
  "422": "Unprocessable Content — well-formed but semantically invalid.",
  "429": "Too Many Requests — rate limited; read Retry-After.",
  "500": "Internal Server Error — unhandled fault on the server.",
  "502": "Bad Gateway — an upstream returned something invalid.",
  "503": "Service Unavailable — temporarily down or overloaded.",
  "504": "Gateway Timeout — an upstream did not answer in time."
};

const MIME: Record<string, string> = {
  json: "application/json", js: "text/javascript", mjs: "text/javascript", ts: "video/mp2t",
  html: "text/html", css: "text/css", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/vnd.microsoft.icon",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip", tar: "application/x-tar",
  csv: "text/csv", txt: "text/plain", md: "text/markdown", xml: "application/xml", yaml: "application/yaml",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", woff2: "font/woff2", woff: "font/woff"
};

export const urlParse: Executor = async (input) => {
  try {
    const u = new URL(str(input).trim());
    const params = [...u.searchParams.entries()];
    return ok([
      `protocol  ${u.protocol}`,
      `host      ${u.hostname}${u.port ? `:${u.port}` : ""}`,
      `path      ${u.pathname}`,
      params.length ? `query:\n${params.map(([k, v]) => `  ${k} = ${v}`).join("\n")}` : "query     (none)",
      u.hash ? `hash      ${u.hash}` : ""
    ].filter(Boolean).join("\n"));
  } catch {
    return fail("Give a full URL including the scheme.");
  }
};

export const slugToTitle: Executor = async (input) => {
  const value = str(input).trim();
  if (!value) return fail("Give a slug.");
  const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
  const words = value.replace(/\.[a-z0-9]+$/i, "").split(/[-_\s/]+/).filter(Boolean);
  const title = words.map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  return ok(title);
};

export const metaTags: Executor = async (input) => {
  const title = str(input, "title") || str(input) || "Page title";
  const description = str(input, "description") || "A one-sentence description, ideally under 160 characters.";
  const url = str(input, "url") || "https://example.com";
  const image = str(input, "image") || `${url.replace(/\/$/, "")}/og.png`;
  return ok([
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${url}">`,
    ``,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    ``,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`
  ].join("\n"), "text/html");
};

export const httpStatus: Executor = async (input) => {
  const code = str(input).replace(/\D/g, "");
  if (!code) {
    return ok(Object.entries(STATUS).map(([k, v]) => `${k}  ${v}`).join("\n"));
  }
  const found = STATUS[code];
  if (found) return ok(`${code} — ${found}`);
  const klass = Number(code[0]);
  const family = ["", "informational", "success", "redirection", "client error", "server error"][klass];
  return ok(family ? `${code} is not a common code, but ${klass}xx means ${family}.` : `Unknown status code ${code}.`);
};

export const mimeType: Executor = async (input) => {
  const value = str(input).trim().toLowerCase().replace(/^.*\./, "");
  if (!value) return fail("Give a file extension or name.");
  const found = MIME[value];
  if (found) return ok(`${value} → ${found}`);
  const reverse = Object.entries(MIME).filter(([, m]) => m.includes(value));
  if (reverse.length) return ok(reverse.map(([e, m]) => `${e} → ${m}`).join("\n"));
  return ok(`No mapping for "${value}". application/octet-stream is the safe default.`);
};

export const userAgentParse: Executor = async (input) => {
  const ua = str(input);
  if (!ua) return fail("Give a User-Agent string.");
  const os = /Windows NT ([\d.]+)/.exec(ua) ? `Windows NT ${/Windows NT ([\d.]+)/.exec(ua)![1]}`
    : /Mac OS X ([\d_.]+)/.exec(ua) ? `macOS ${/Mac OS X ([\d_.]+)/.exec(ua)![1].replace(/_/g, ".")}`
    : /Android ([\d.]+)/.exec(ua) ? `Android ${/Android ([\d.]+)/.exec(ua)![1]}`
    : /(iPhone|iPad).*OS ([\d_]+)/.exec(ua) ? `iOS ${/(iPhone|iPad).*OS ([\d_]+)/.exec(ua)![2].replace(/_/g, ".")}`
    : /Linux/.test(ua) ? "Linux" : "unknown";
  const browser = /Edg\/([\d.]+)/.exec(ua) ? `Edge ${/Edg\/([\d.]+)/.exec(ua)![1]}`
    : /OPR\/([\d.]+)/.exec(ua) ? `Opera ${/OPR\/([\d.]+)/.exec(ua)![1]}`
    : /Firefox\/([\d.]+)/.exec(ua) ? `Firefox ${/Firefox\/([\d.]+)/.exec(ua)![1]}`
    : /Chrome\/([\d.]+)/.exec(ua) ? `Chrome ${/Chrome\/([\d.]+)/.exec(ua)![1]}`
    : /Version\/([\d.]+).*Safari/.exec(ua) ? `Safari ${/Version\/([\d.]+).*Safari/.exec(ua)![1]}`
    : "unknown";
  const bot = /bot|crawler|spider|curl|wget|headless/i.test(ua);
  return ok([`browser  ${browser}`, `os       ${os}`, `mobile   ${/Mobi|Android|iPhone/.test(ua) ? "yes" : "no"}`, `bot      ${bot ? "likely" : "no"}`].join("\n"));
};

export const cookieParse: Executor = async (input) => {
  const raw = str(input);
  if (!raw) return fail("Give a Cookie or Set-Cookie header.");
  const parts = raw.split(";").map((p) => p.trim()).filter(Boolean);
  const flags = new Set(["secure", "httponly", "partitioned"]);
  return ok(parts.map((p, i) => {
    const eq = p.indexOf("=");
    if (eq < 0) return `${flags.has(p.toLowerCase()) ? "flag" : "?   "}  ${p}`;
    const key = p.slice(0, eq);
    const value = p.slice(eq + 1);
    return `${i === 0 ? "name" : "attr"}  ${key} = ${value}`;
  }).join("\n"));
};

export const corsHeaders: Executor = async (input) => {
  const origin = str(input, "origin") || str(input) || "https://example.com";
  const methods = str(input, "methods") || "GET, POST, OPTIONS";
  return ok([
    `Access-Control-Allow-Origin: ${origin}`,
    `Access-Control-Allow-Methods: ${methods}`,
    `Access-Control-Allow-Headers: Content-Type, Authorization`,
    `Access-Control-Max-Age: 86400`,
    input.credentials ? `Access-Control-Allow-Credentials: true` : "",
    ``,
    origin === "*" && input.credentials
      ? "Note: a wildcard origin and Allow-Credentials cannot be combined — browsers reject it. Echo the specific origin instead."
      : "Preflight is only sent for non-simple requests; a simple GET will not show OPTIONS."
  ].filter(Boolean).join("\n"));
};

export const robotsTxt: Executor = async (input) => {
  const host = str(input, "host") || str(input) || "https://example.com";
  const disallow = (str(input, "disallow") || "/admin,/api").split(",").map((s) => s.trim()).filter(Boolean);
  return ok([`User-agent: *`, ...disallow.map((p) => `Disallow: ${p}`), `Allow: /`, ``, `Sitemap: ${host.replace(/\/$/, "")}/sitemap.xml`].join("\n"));
};

export const sitemapEntry: Executor = async (input) => {
  const urls = str(input).split(/[\s,]+/).filter(Boolean);
  if (!urls.length) return fail("Give one or more URLs.");
  const today = new Date().toISOString().slice(0, 10);
  const body = urls.map((u) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>`).join("\n");
  return ok(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`, "application/xml");
};

export const faviconSizes: Executor = async () => ok([
  "The set that actually covers current browsers and installs:",
  "",
  "favicon.ico          16, 32, 48 (multi-size ICO, for legacy and bookmarks)",
  "favicon.svg          any        <link rel=\"icon\" type=\"image/svg+xml\">",
  "apple-touch-icon.png 180x180    iOS home screen, no transparency",
  "icon-192.png         192x192    PWA manifest, Android",
  "icon-512.png         512x512    PWA splash and install prompt",
  "maskable-512.png     512x512    purpose=\"maskable\", keep art inside the central 80%",
  "",
  "Anything beyond these is legacy weight."
].join("\n"));

export const dataUri: Executor = async (input) => {
  const text = str(input);
  if (!text) return fail("Give text to encode.");
  const mime = String(input.mime ?? "text/plain");
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return ok(`data:${mime};base64,${btoa(binary)}`);
};

export const srcsetGenerate: Executor = async (input) => {
  const base = str(input).trim() || "/image.jpg";
  const widths = (String(input.widths ?? "320,640,960,1280,1920")).split(",").map((w) => Number(w.trim())).filter(Boolean);
  const [name, ext] = [base.replace(/\.[^.]+$/, ""), (base.match(/\.[^.]+$/) ?? [".jpg"])[0]];
  const srcset = widths.map((w) => `${name}-${w}w${ext} ${w}w`).join(",\n          ");
  return ok(`<img src="${base}"\n     srcset="${srcset}"\n     sizes="(max-width: 640px) 100vw, 640px"\n     width="1280" height="720"\n     alt="" loading="lazy" decoding="async">`, "text/html");
};

export const mediaQuery: Executor = async (input) => {
  const name = str(input).trim().toLowerCase();
  const all = [
    ["mobile", "@media (max-width: 639px) { }"],
    ["tablet", "@media (min-width: 640px) and (max-width: 1023px) { }"],
    ["desktop", "@media (min-width: 1024px) { }"],
    ["dark", "@media (prefers-color-scheme: dark) { }"],
    ["reduced-motion", "@media (prefers-reduced-motion: reduce) { }"],
    ["print", "@media print { }"],
    ["hover", "@media (hover: hover) and (pointer: fine) { }"],
    ["touch", "@media (hover: none) and (pointer: coarse) { }"],
    ["retina", "@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) { }"],
    ["portrait", "@media (orientation: portrait) { }"]
  ];
  const hit = all.filter(([k]) => !name || k.includes(name));
  return ok((hit.length ? hit : all).map(([k, v]) => `/* ${k} */\n${v}`).join("\n\n"), "text/css");
};
