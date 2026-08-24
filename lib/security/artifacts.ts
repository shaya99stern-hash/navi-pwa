import type { ArtifactPayload } from "../ai/types";

const MAX_ARTIFACT_BYTES = 180_000;

export function validateArtifactPayload(value: unknown): { ok: true; payload: ArtifactPayload } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Artifact payload must be an object." };
  const candidate = value as Partial<ArtifactPayload>;
  if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) return { ok: false, error: "Artifact id is invalid." };
  if (typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 120) return { ok: false, error: "Artifact title is invalid." };
  if (candidate.kind !== "html" && candidate.kind !== "svg") return { ok: false, error: "Artifact kind must be html or svg." };
  const content = candidate.kind === "html" ? candidate.html : candidate.svg;
  if (typeof content !== "string" || content.length < 1) return { ok: false, error: "Artifact content is missing." };
  if (new TextEncoder().encode(content).byteLength > MAX_ARTIFACT_BYTES) return { ok: false, error: "Artifact is too large." };
  return {
    ok: true,
    payload: {
      id: candidate.id,
      title: candidate.title.trim(),
      kind: candidate.kind,
      html: candidate.kind === "html" ? content : undefined,
      svg: candidate.kind === "svg" ? content : undefined,
      height: typeof candidate.height === "number" ? Math.min(900, Math.max(180, candidate.height)) : 360
    }
  };
}

/* ── Salvage, as distinct from validation ───────────────────────────────────
   Validation answers "is this payload exactly right"; salvage answers "is
   there a renderable artifact in what the model actually sent". Models emit
   trailing commas, smart quotes, prose around the JSON, kinds like
   "markdown" or "pdf", content under keys like `content` or `code`, and
   sometimes raw markup with no JSON at all. Every one of those used to
   surface as "Malformed artifact payload." — the single most reported
   failure in this app's history. Nothing here weakens the security posture:
   whatever is salvaged still flows through the same sanitizers before it is
   rendered. */

/**
 * Fence languages that mean "this is an artifact".
 *
 * The contract says `navi-artifact`, and models routinely emit `artifact`,
 * `react-component`, or `html-artifact` instead. Nothing rendered those, so a
 * complete working payload arrived as a wall of raw JSON in a code block —
 * indistinguishable, to the reader, from the app being broken.
 *
 * Aliases are honoured only when the fence body actually looks like an
 * artifact payload (see `looksLikeArtifactFence`), so a code block someone
 * genuinely wanted to read as code is never swallowed.
 */
const ARTIFACT_FENCE_ALIASES = new Set([
  "navi-artifact", "artifact", "artifacts", "naviartifact",
  "react-component", "react_component", "html-artifact", "navi-html"
]);

/**
 * Any label that mentions an artifact counts.
 *
 * The fixed set above could not keep up: a real reply arrived fenced
 * `naviopi-artifact`, which is not a spelling anyone would think to enumerate,
 * and it rendered as a wall of raw JSON titled NAVIOPI-ARTIFACT. Matching the
 * word rather than the exact string covers the whole family of near-misses —
 * and it stays safe because an aliased fence still has to carry an
 * artifact-shaped body before anything renders (see `looksLikeArtifactFence`).
 */
export function isArtifactFenceLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  if (ARTIFACT_FENCE_ALIASES.has(normalized)) return true;
  return /artifact/.test(normalized) || /^react[-_]?component$/.test(normalized);
}

/**
 * Whether a fence body is an artifact payload rather than ordinary code.
 *
 * Required because the aliases are ambiguous: `artifact` is not a language,
 * but someone could still label a snippet with it. A payload is a JSON object
 * carrying artifact-shaped keys — that is a far stronger signal than the
 * fence label, and it is what decides.
 */
/**
 * The artifact payload inside a fence, however the model spelled the fence.
 *
 * Third near-miss shape this file has had to absorb, and the pattern is worth
 * naming: the contract asks for ```` ```navi-artifact ````, free-tier models
 * approximate it, and every approximation renders a complete working artifact
 * as a wall of raw JSON — which reads, to the person who asked for a kitchen,
 * exactly like the app being broken.
 *
 * The one added here is the label on its own line inside an *unlabelled* fence:
 *
 *     ```
 *     navi-artifact
 *     { "id": "...", "kind": "html", "html": "..." }
 *     ```
 *
 * No language on the fence, so every alias check missed it, and the payload was
 * shown as plain text with the word `navi-artifact` sitting at the top of it.
 *
 * Held tight deliberately: the first line must be a bare alias-shaped token —
 * short, no whitespace — and what follows must parse as an artifact payload.
 * A code block someone genuinely wanted to read as code is never swallowed,
 * which is the same rule the aliases already follow.
 *
 * Returns the payload text, or null when this is an ordinary fence.
 */
export function artifactFenceBody(language: string, body: string): string | null {
  /* Before the label is consulted at all. A fence containing nothing but an
     artifact header is an artifact however it was labelled — and the one that
     sent the owner here carried no label, so every check below it missed. */
  if (isLoneArtifactHeader(body)) return body;

  /* The canonical contract renders on the label alone: a malformed payload
     under the exact fence is an artifact that failed, and saying so is the
     gate's job rather than this one's. */
  if (language.trim().toLowerCase() === "navi-artifact") return body;
  if (isArtifactFenceLanguage(language) && looksLikeArtifactFence(body)) return body;

  const newline = body.indexOf("\n");
  if (newline < 0) return null;
  const label = body.slice(0, newline).trim();
  /* A bare token, not a line of prose that happens to contain the word. */
  if (!label || label.length > 40 || /\s/.test(label)) return null;
  if (!isArtifactFenceLanguage(label)) return null;

  const payload = body.slice(newline + 1);
  /* `looksLikeJsonEnvelope` as well as the full parse, because the payload that
     sent the owner here was *truncated* — the reply ran past the output limit
     mid-string, so it can never parse, and requiring a parse meant the one
     shape most in need of an explanation got none.

     There is already an honest message waiting for it — "cut off before it
     finished, ask for it again or for a simpler version" — produced by
     `recoverArtifactPayload`. It never ran, because nothing upstream recognised
     the fence as an artifact at all. Recognition has to be tolerant enough to
     reach the code that can explain the failure; being strict here turned a
     clear diagnosis into a wall of raw JSON. */
  if (looksLikeArtifactFence(payload) || looksLikeJsonEnvelope(payload)) return payload;
  return null;
}

export function looksLikeArtifactFence(body: string): boolean {
  if (splitHeaderArtifact(body)) return true;
  const parsed = tolerantParseJson(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const hasContent = CONTENT_KEYS.some((key) => typeof record[key] === "string" && record[key]);
  return hasContent && (typeof record.title === "string" || typeof record.kind === "string" || typeof record.id === "string");
}

/** JSON.parse, then increasingly forgiving repairs. Undefined when hopeless. */
export function tolerantParseJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* keep trying */ }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  const slice = trimmed.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { /* keep trying */ }
  try { return JSON.parse(repairJsonText(slice)); } catch { return undefined; }
}

/**
 * The three repairs that cover nearly every real model failure: typographic
 * quotes as string delimiters, literal newlines inside string values, and a
 * trailing comma before a closing brace.
 */
function repairJsonText(text: string): string {
  const straightened = text.replace(/[“”″]/g, '"');
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of straightened) {
    if (inString) {
      if (escaped) { out += char; escaped = false; continue; }
      if (char === "\\") { out += char; escaped = true; continue; }
      if (char === '"') { inString = false; out += char; continue; }
      if (char === "\n") { out += "\\n"; continue; }
      if (char === "\t") { out += "\\t"; continue; }
      if (char === "\r") continue;
      out += char;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Enough markdown to render a document artifact: headings, emphasis, code,
 * links, lists, rules, paragraphs. Everything is escaped first, so the input
 * can only ever produce the tags written here.
 */
export function markdownToArtifactHtml(markdown: string): string {
  const codeBlocks: string[] = [];
  const withPlaceholders = markdown.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_full, code: string) => {
    const index = codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`) - 1;
    return ` CODE${index} `;
  });

  const inline = (text: string) => escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<a>$1</a> ($2)");

  const blocks = withPlaceholders.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").filter((line) => line.trim());
    if (!lines.length) return "";
    if (/^ CODE\d+ $/.test(lines[0].trim()) && lines.length === 1) return lines[0].trim();
    if (lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) {
      const ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
      const items = lines.map((line) => `<li>${inline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>`).join("");
      return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (/^(?:-{3,}|\*{3,})$/.test(lines[0].trim()) && lines.length === 1) return "<hr>";
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  });

  return blocks.filter(Boolean).join("\n")
    .replace(/ CODE(\d+) /g, (_token, index: string) => codeBlocks[Number(index)] ?? "");
}

/* `artifact` and `payload` are here because models wrap the whole thing one
   level too deep — an observed reply was literally
   {"artifact": "```navi-artifact\n<!DOCTYPE html>…"}, whose content key was
   the one key this list did not have. */
const CONTENT_KEYS = ["html", "svg", "content", "code", "body", "markdown", "md", "text", "source", "document", "artifact", "payload"] as const;

/**
 * Strip a fence that has been nested inside a payload.
 *
 * Two wrappings show up in practice: an artifact fenced inside a ```json block,
 * and an envelope whose content string is itself a complete ```navi-artifact
 * fence. Either way the real payload is one unwrapping away, and without this
 * the reader gets "could not be read as JSON" for an artifact that is entirely
 * intact — the most annoying possible failure, because nothing is actually
 * wrong with it.
 */
export function unwrapFencedPayload(text: string): string {
  let current = text.trim();
  // Bounded: each pass must remove a fence, and three is past any real nesting.
  for (let depth = 0; depth < 3; depth += 1) {
    const match = /^```[a-z0-9_-]*\s*\n([\s\S]*?)\n?```$/i.exec(current.trim());
    if (!match) return current;
    current = match[1].trim();
  }
  return current;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function looksLikeMarkup(text: string): boolean {
  return /<([a-z][a-z0-9-]*)(\s|>|\/)/i.test(text);
}

/**
 * Build a valid payload out of whatever arrived — a loose object, or the raw
 * fence text itself. Null only when there is genuinely no content to show.
 */
export function repairArtifactPayload(value: unknown, depth = 0): ArtifactPayload | null {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const raw = typeof value === "string" ? value : firstString(record, CONTENT_KEYS);
  /* The content key may itself hold a whole fenced block, because the model
     wrapped the artifact one level too deep. Unwrap before deciding what it
     is: judged as-is, a fenced payload "looks like" markdown and would be
     rendered as a code listing of itself. */
  const content = unwrapFencedPayload(raw.trim());
  if (!content) return null;

  /* Unwrapping revealed another envelope — the nesting was JSON-in-JSON rather
     than JSON-in-fence. Recurse once so the inner object supplies the title,
     kind and id that the outer wrapper never had. `depth` is what stops a
     self-referential payload from looping. */
  if (depth < 2 && content !== raw.trim() && content.trimStart().startsWith("{")) {
    const inner = tolerantParseJson(content);
    if (inner && typeof inner === "object") {
      const strict = validateArtifactPayload(inner);
      if (strict.ok) return strict.payload;
      const repaired = repairArtifactPayload(inner, depth + 1);
      if (repaired) return repaired;
    }
  }

  if (new TextEncoder().encode(content).byteLength > MAX_ARTIFACT_BYTES) return null;

  const declaredKind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  const isSvg = declaredKind === "svg" || /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(content);

  const title = (firstString(record, ["title", "name", "heading", "label"])
    || /^#{1,6}\s+(.+)$/m.exec(content)?.[1]
    || /<(?:title|h1)[^>]*>([^<]+)</i.exec(content)?.[1]
    || "Artifact").trim().slice(0, 120);

  const providedId = typeof record.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(record.id) ? record.id : "";
  const id = providedId
    || title.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
    || `artifact-${content.length}`;

  const html = isSvg ? undefined : looksLikeMarkup(content) ? content : markdownToArtifactHtml(content);
  return {
    id,
    title,
    kind: isSvg ? "svg" : "html",
    html,
    svg: isSvg ? content : undefined,
    height: typeof record.height === "number" ? Math.min(900, Math.max(180, record.height)) : 360
  };
}

/**
 * The one entry point renderers and the stream gate share: strict validation
 * first, salvage second, a stated reason only when both fail.
 */
/**
 * Was this meant to be an envelope, as opposed to raw markup?
 *
 * The discriminator is the opening character: an envelope starts `{`, raw
 * markup starts `<`. That matters because the two take opposite paths when
 * parsing fails — a broken envelope must be reported, while raw markup should
 * still be salvaged.
 */
export function looksLikeJsonEnvelope(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return false;
  return /"(?:kind|html|svg|id|title)"\s*:/.test(trimmed.slice(0, 400));
}

/**
 * An unterminated string, which is the signature of a generation that stopped
 * at its output limit rather than one that was malformed from the start.
 *
 * Counted rather than pattern-matched: the escapes inside a truncated HTML
 * payload defeat any regex that tries to find the closing quote, and getting
 * this wrong would mislabel the cause in the one message the user sees.
 */
function hasUnterminatedString(text: string): boolean {
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString && character === "\\") { index += 1; continue; }
    if (character === '"') inString = !inString;
  }
  return inString;
}

/**
 * The header+body shape: a single-line JSON header, a line of three dashes,
 * then the document itself, unescaped.
 *
 * The old contract asked the model to put a whole HTML document inside a JSON
 * string. That works — a stored payload proves the escaping was done correctly
 * — but every quote becomes an escaped quote and every newline a literal
 * two-character escape, so the document costs roughly twice the tokens to
 * emit. Against a free tier
 * metered at 6,000 tokens a minute, a page that would comfortably fit does
 * not, and generation stops mid-string. The evidence is a stored artifact that
 * ends, exactly, at `box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);`.
 *
 * So this is a cost fix rather than a correctness one: the same document, half
 * the tokens, and the model no longer has to escape anything.
 *
 * The delimiter is the *first* three-dash line, which is what makes a `---`
 * inside the document harmless — an `<hr>`, a YAML front-matter block, or a
 * markdown rule in the body all survive, because everything after the first
 * delimiter is taken verbatim.
 *
 * Null when this is not that shape, which sends the caller down the JSON path
 * unchanged. Legacy artifacts are already stored in the cloud and must keep
 * rendering.
 */
/**
 * A header with nothing under it: the artifact that ran out of room.
 *
 * Reasoning models emit their deliberation as output tokens, against the same
 * allowance as the answer. Asked for an interactive mood board on a free tier,
 * one thought at length and then produced exactly this and stopped:
 *
 *     {"id":"kitchen-moodboard","title":"Kitchen Mood Board","kind":"html","height":500}
 *
 * A complete, correct header with no document under it. It arrived in an
 * unlabelled fence, which nothing claimed, so it reached the reader as a code
 * block full of raw JSON — the exact failure the fence aliases exist to
 * prevent, wearing a different hat.
 *
 * Recognition has to be tight, because claiming an ordinary code block is the
 * worse error: all of id, title and a real artifact kind, no content key, and
 * nothing else in the fence at all. That is not a shape anyone writes as a
 * sample.
 */
export function isLoneArtifactHeader(body: string): boolean {
  /* A trailing delimiter is the same failure one token later: the model got as
     far as the line that introduces the document and no further. */
  const trimmed = body.trim().replace(/\n\s*-{3,}[ \t]*$/, "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  const parsed = tolerantParseJson(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.title !== "string") return false;
  if (record.kind !== "html" && record.kind !== "svg") return false;
  return !CONTENT_KEYS.some((key) => typeof record[key] === "string" && (record[key] as string).trim());
}

export function splitHeaderArtifact(body: string): { header: string; content: string } | null {
  const match = /^\s*(\{[^\n]*\})\s*\n\s*-{3,}[ \t]*\n/.exec(body);
  if (!match) return null;
  const content = body.slice(match[0].length);
  if (!content.trim()) return null;

  /* A complete JSON envelope that happens to be followed by a dashed line is
     not a header. Deciding by whether the object already carries the content
     keeps the two shapes from competing for the same text. */
  const parsed = tolerantParseJson(match[1]);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (CONTENT_KEYS.some((key) => typeof record[key] === "string" && (record[key] as string).trim())) return null;
  }
  return { header: match[1], content };
}

/**
 * A header+body artifact, resolved through the same repair path as every other
 * shape so it inherits the title, id, kind and height defaulting rather than
 * growing a second copy of it.
 */
function payloadFromHeaderArtifact(split: { header: string; content: string }): ArtifactPayload | null {
  const parsed = tolerantParseJson(split.header);
  const record: Record<string, unknown> =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  /* Under `content` rather than `html`, so the kind is decided by what the
     document actually is when the header does not say — a header claiming
     `html` over an `<svg>` document is a mislabel, not an instruction. */
  record.content = split.content;
  return repairArtifactPayload(record);
}

export function recoverArtifactPayload(fenceText: string): { ok: true; payload: ArtifactPayload } | { ok: false; error: string } {
  /* Unwrap first. A payload that arrived inside a second fence is complete and
     valid; only its packaging is wrong, and reporting a JSON error for it
     would be blaming the content for the envelope. */
  const unwrapped = unwrapFencedPayload(fenceText);
  if (unwrapped !== fenceText.trim()) {
    const inner = recoverArtifactPayload(unwrapped);
    if (inner.ok) return inner;
  }

  /* A header alone parses perfectly and fails validation for having no
     content, which is true but reads as the model having done something wrong.
     It did not: it ran out of room. */
  if (isLoneArtifactHeader(fenceText)) {
    return {
      ok: false,
      error: "Only the heading arrived — this reply ran out of room before it could write the document. Ask again, or for a simpler version."
    };
  }

  /* Before the JSON path: a header+body artifact opens with `{` too, so
     `tolerantParseJson` would take the header alone as the whole payload and
     find no content in it. */
  const split = splitHeaderArtifact(fenceText);
  if (split) {
    const payload = payloadFromHeaderArtifact(split);
    if (payload) return { ok: true, payload };
  }

  const parsed = tolerantParseJson(fenceText);
  if (parsed !== undefined) {
    const strict = validateArtifactPayload(parsed);
    if (strict.ok) return strict;
    const repaired = repairArtifactPayload(parsed);
    if (repaired) return { ok: true, payload: repaired };
    return strict;
  }

  /* Parsing failed. If this was meant to be an envelope, salvage must not run.
     `looksLikeMarkup` matches the tags sitting *inside* the unterminated
     "html" string, and `repairArtifactPayload` then renders the entire
     envelope as the document — which is the observed failure: a page
     displaying its own JSON, escape sequences and all.

     Reporting the cause is also worth more than a generic message here,
     because the two causes have different remedies: a cut-off artifact is
     worth asking for again, an invalid one is not. */
  if (looksLikeJsonEnvelope(fenceText)) {
    return {
      ok: false,
      error: hasUnterminatedString(fenceText)
        ? "That artifact was cut off before it finished — it ran past the output limit. Ask for it again, or for a simpler version."
        : "That artifact could not be read: the payload was not valid JSON."
    };
  }

  if (looksLikeMarkup(fenceText)) {
    const repaired = repairArtifactPayload(fenceText);
    if (repaired) return { ok: true, payload: repaired };
  }
  return { ok: false, error: "The artifact payload could not be read as JSON." };
}

export function sanitizeSvgText(svg: string): string {
  let sanitized = svg;
  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
      .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  } while (sanitized !== previous);

  let attrSanitized = sanitized;
  do {
    previous = attrSanitized;
    attrSanitized = attrSanitized
      .replace(/(\s)on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, "$1")
      .replace(/\s(?:href|xlink:href)\s*=\s*("|')\s*(?:https?:|javascript:|data:text\/html)[\s\S]*?\1/gi, "");
  } while (attrSanitized !== previous);

  return attrSanitized;
}

export function sanitizeArtifactHtml(html: string): string {
  const inlineScripts: string[] = [];
  const externalScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']+\1[^>]*>[\s\S]*?<\/script>/gi;
  let withoutExternalScripts = html;
  let previous: string;
  do {
    previous = withoutExternalScripts;
    withoutExternalScripts = withoutExternalScripts.replace(externalScriptPattern, "");
  } while (withoutExternalScripts !== previous);
  const protectedHtml = withoutExternalScripts.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi, (_full, script: string) => {
    const index = inlineScripts.push(script) - 1;
    return `__NAVI_INLINE_SCRIPT_${index}__`;
  });

  let sanitizedMarkup = protectedHtml;
  let markupPrevious: string;
  do {
    markupPrevious = sanitizedMarkup;
    sanitizedMarkup = sanitizedMarkup
      .replace(/<\/?(?:iframe|object|embed|base|link)\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv\s*=\s*("|')?refresh\1?[^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:action|formaction|target)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:href|src)\s*=\s*("|')\s*(?:https?:|javascript:|data:text\/html)[\s\S]*?\1/gi, "");
  } while (sanitizedMarkup !== markupPrevious);

  return sanitizedMarkup.replace(/__NAVI_INLINE_SCRIPT_(\d+)__/g, (_token, rawIndex: string) => {
    const script = inlineScripts[Number(rawIndex)] ?? "";
    return `<script>${script}</script>`;
  });
}

/**
 * Repair for the commonest visual defect in generated artifacts: a model
 * writes a light-mode design — `background:#fff` on a wrapper, pale grey
 * text — and in a dark app it renders as a glaring white slab, sometimes with
 * text at almost no contrast against it.
 *
 * The rule only fires in dark mode, and only on the near-white backgrounds
 * that are always an accident of the model assuming a white page. A
 * deliberate colour — a chart's palette, a coloured card, a brand fill — is
 * untouched, because only literal white and the two off-whites are matched.
 * Text colour is inherited back so a pale-grey-on-white pairing does not
 * survive as pale-grey-on-dark.
 */
const LIGHT_BACKGROUND_SELECTORS = [
  "#fff", "#ffffff", "white", "#f9f9f9", "#fafafa", "#f5f5f5"
].flatMap((value) => [
  `[style*="background:${value}" i]`,
  `[style*="background: ${value}" i]`,
  `[style*="background-color:${value}" i]`,
  `[style*="background-color: ${value}" i]`
]).join(",");

/* Keyed off the app's own theme rather than `prefers-color-scheme`: the app
   has an explicit dark/light setting that can disagree with the OS, and the
   media query would read the OS and miss exactly the case this repairs. */
const THEME_REPAIR_CSS = `${LIGHT_BACKGROUND_SELECTORS}{background:var(--navi-surface)!important;background-color:var(--navi-surface)!important;color:var(--navi-fg)!important}`;

export function buildArtifactDocument(payload: ArtifactPayload, theme: "dark" | "light"): string {
  const background = theme === "dark" ? "#11141C" : "#FFFFFF";
  const foreground = theme === "dark" ? "#F5F7FB" : "#101623";
  const muted = theme === "dark" ? "#9AA4BA" : "#5B6578";
  const border = theme === "dark" ? "#2B3345" : "#D9E0EC";
  const surface = theme === "dark" ? "#181D28" : "#F4F7FB";
  const accent = "#4F7CFF";
  const content = payload.kind === "svg" ? sanitizeSvgText(payload.svg ?? "") : sanitizeArtifactHtml(payload.html ?? "");
  const rendered = payload.kind === "svg" ? `<div class="svg-wrap">${content}</div>` : content;
  const hasArtifactScript = payload.kind === "html" && /<script\b(?![^>]*\bsrc\s*=)/i.test(content);

  const fallbackInteractions = hasArtifactScript ? "" : `
    const getStatus = host => {
      let status = host.querySelector('[data-navi-status]');
      if (!status) {
        status = document.createElement('div');
        status.setAttribute('data-navi-status', 'true');
        status.setAttribute('role', 'status');
        host.appendChild(status);
      }
      return status;
    };
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || button.disabled) return;
      button.classList.add('navi-activated');
      button.setAttribute('aria-pressed', 'true');
      const host = button.closest('form,section,article,main,div') || document.body;
      const status = getStatus(host);
      const label = (button.textContent || 'Action').trim();
      status.textContent = button.dataset.result || button.dataset.success || label + ' completed.';
      send('artifact:interaction', { action: button.dataset.action || 'button', label });
      resize();
    });
    document.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const status = getStatus(form);
      status.textContent = form.dataset.success || 'Submitted securely inside this artifact.';
      send('artifact:interaction', { action: form.dataset.action || 'submit' });
      resize();
    });
  `;

  const bridge = `
    const send = (type, extra = {}) => parent.postMessage({ type, id: ${JSON.stringify(payload.id)}, ...extra }, '*');
    /* Measure the content, not the document box.
       Inside an iframe \`documentElement\` *is* the viewport, so its
       scrollHeight is whatever height the parent last set — and body carries
       16px of padding, so reporting it added 32px on every observation. The
       frame ratcheted 360 to 392 to 424 upward until it hit its clamp, leaving
       a large dead region below content that had never grown at all.
       Content sized in viewport units fills whatever it is given and can never
       report a natural height, so it is reported unchanged rather than with
       padding added, which is what stops the loop at its source. */
    const measure = () => {
      const viewport = window.innerHeight;
      const edges = Array.from(document.body.children).map(el => el.getBoundingClientRect().bottom + window.scrollY);
      const content = edges.length ? Math.ceil(Math.max.apply(null, edges)) : 0;
      return content <= viewport + 4 ? viewport : content + 16;
    };
    const resize = () => send('artifact:resize', { height: measure() });

    /* A tape measure rather than eyes.
       A rendered artifact cannot be screenshotted from the parent — it is a
       sandboxed cross-origin frame, and no browser will hand a page a picture
       of one it does not own. Rendering server-side means a headless browser,
       which cannot run on edge and is not free at any real volume.
       But the failures that actually happen here are not matters of taste, they
       are matters of arithmetic: a frame twice the height of its content, a
       control smaller than a fingertip, a panel sitting on top of the thing it
       describes. Those are measurable exactly, on the device, for nothing — and
       a measurement beats a description of a picture at every one of them.
       Reported once after layout settles. The reviewer reads numbers; the user
       never sees this. */
    const audit = () => {
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const nodes = Array.from(document.body.querySelectorAll('*')).slice(0, 800);
      const findings = [];
      const box = el => el.getBoundingClientRect();

      const edges = Array.from(document.body.children).map(el => box(el).bottom + window.scrollY);
      const content = edges.length ? Math.ceil(Math.max.apply(null, edges)) : 0;
      /* The failure from the garden artifact: a frame at its clamp with content
         filling a third of it. Reported as the two numbers rather than as a
         judgement, because 'looks empty' is not actionable and '488px of dead
         space below the content' is. */
      if (content > 0 && viewport.h - content > 120) {
        findings.push('Dead space: content ends at ' + content + 'px but the frame is ' + viewport.h + 'px, leaving ' + (viewport.h - content) + 'px empty below it.');
      }

      const wide = nodes.filter(el => box(el).width > viewport.w + 2);
      if (wide.length) findings.push(wide.length + ' element(s) are wider than the ' + viewport.w + 'px frame and will clip horizontally.');

      const offscreen = nodes.filter(el => { const r = box(el); return r.width > 0 && r.height > 0 && (r.right < 0 || r.left > viewport.w); });
      if (offscreen.length) findings.push(offscreen.length + ' element(s) sit outside the frame horizontally and cannot be seen.');

      /* 44px is the platform's own minimum, and this renders on a phone. */
      const tappable = nodes.filter(el => /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.onclick);
      const small = tappable.filter(el => { const r = box(el); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24); });
      if (small.length) findings.push(small.length + ' interactive element(s) are under the 44px minimum touch target.');

      const hidden = nodes.filter(el => {
        const style = getComputedStyle(el);
        return el.textContent && el.textContent.trim() && style.color === style.backgroundColor;
      });
      if (hidden.length) findings.push(hidden.length + ' element(s) have text the same colour as their background.');

      send('artifact:audit', { findings: findings, content: content, viewport: viewport.h });
    };
    ${fallbackInteractions}
    addEventListener('load', () => {
      send('artifact:ready', { height: measure() });
      resize();
      /* After a frame, so the parent's resize has landed and the measurements
         describe what the user will actually see rather than the initial box. */
      requestAnimationFrame(() => requestAnimationFrame(audit));
    });
    /* Observing the body rather than the documentElement, for the same reason:
       the documentElement resizes because *we* resized, which is not news. */
    new ResizeObserver(resize).observe(document.body);
    addEventListener('error', event => send('artifact:error', { message: String(event.message || 'Artifact error') }));
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"><style>:root{--navi-bg:${background};--navi-fg:${foreground};--navi-muted:${muted};--navi-border:${border};--navi-surface:${surface};--navi-accent:${accent};color-scheme:${theme}}html,body{margin:0;background:${background};color:${foreground};font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}${theme === "dark" ? THEME_REPAIR_CSS : ""}body{padding:16px;overflow:auto}*{box-sizing:border-box}.svg-wrap{display:flex;align-items:center;justify-content:center;min-height:180px}.svg-wrap svg{max-width:100%;height:auto}pre{overflow:auto;border:1px solid ${border};border-radius:12px;padding:12px}button,input,select,textarea{font:inherit}button{min-height:44px;border:1px solid ${border};border-radius:12px;background:${surface};color:inherit;padding:10px 14px;cursor:pointer;transition:transform .12s ease,background .12s ease,opacity .12s ease}button:active{transform:scale(.97)}button.navi-activated{background:${accent};border-color:${accent};color:#fff}input,select,textarea{width:100%;min-height:44px;border:1px solid ${border};border-radius:12px;background:${surface};color:${foreground};padding:10px 12px;outline:none}input:focus,select:focus,textarea:focus{border-color:${accent}}label{display:block;margin:10px 0 6px;color:${muted};font-size:13px}[data-navi-status]{margin-top:12px;border:1px solid ${border};border-radius:12px;background:${surface};padding:10px 12px;color:${foreground};font-size:14px}</style></head><body>${rendered}<script>${bridge}<\/script></body></html>`;
}
