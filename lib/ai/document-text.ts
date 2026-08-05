/**
 * Reading documents as documents.
 *
 * PDFs and CSVs were accepted and then handed to a vision model, which is not
 * reading — it is looking at a picture of reading. A rendered page loses the
 * things that make a document a document: a table's column alignment becomes a
 * guess, a two-column layout interleaves into nonsense, and a contract long
 * enough to matter exceeds what any vision pass will attend to. The answers
 * come back confident and wrong, which is the worst combination.
 *
 * Text is extracted before the model call instead. Vision stays as the fallback
 * for scanned pages that genuinely have no text layer, where a picture is all
 * there is.
 */

/** Past this a document costs more budget than the answer is worth. */
const MAX_DOCUMENT_CHARS = 60_000;
/** A table wider than this is unreadable in a chat, whatever the source had. */
const MAX_CSV_COLUMNS = 12;
const MAX_CSV_ROWS = 200;

export type ExtractedDocument = {
  text: string;
  /** True when the document was longer than the budget and was cut. */
  truncated: boolean;
  /** Pages, when the format has them. */
  pages?: number;
};

function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true };
}

/**
 * Pull the text layer out of a PDF.
 *
 * Returns null when there is nothing to pull — a scan, an image-only export, a
 * file that is not really a PDF. Null is the signal to fall back to vision
 * rather than an error, because for those files vision is the correct tool
 * rather than a degraded one.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedDocument | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(document, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();

    /* A handful of characters across many pages is a scan with stray OCR
       artefacts, not a document with a text layer. Treating that as extracted
       text would hand the model near-nothing and stop it from looking. */
    if (merged.length < 40) return null;

    const { text: clipped, truncated } = clip(merged);
    return { text: clipped, truncated, pages: totalPages };
  } catch (error) {
    console.warn("NaviSol could not extract text from a PDF:", error);
    return null;
  }
}

/**
 * A CSV rendered as a table the model can actually read.
 *
 * Raw CSV in a prompt is readable in principle and unreliable in practice —
 * quoted commas, ragged rows, and a header that looks like data all cost
 * attention that should go to the question. A markdown table settles the shape
 * once, up front.
 */
export function csvToMarkdown(source: string): ExtractedDocument {
  const rows = parseCsv(source);
  if (!rows.length) return { text: "", truncated: false };

  const width = Math.min(MAX_CSV_COLUMNS, Math.max(...rows.map((row) => row.length)));
  const kept = rows.slice(0, MAX_CSV_ROWS);
  const truncated = rows.length > MAX_CSV_ROWS || rows.some((row) => row.length > width);

  const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => cell(row[index] ?? "")).join(" | ")} |`;

  const body = [
    line(kept[0]),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...kept.slice(1).map(line)
  ].join("\n");

  const notes: string[] = [];
  if (rows.length > MAX_CSV_ROWS) notes.push(`Showing the first ${MAX_CSV_ROWS} of ${rows.length} rows.`);
  if (rows.some((row) => row.length > width)) notes.push(`Showing the first ${width} columns.`);

  return { text: notes.length ? `${body}\n\n${notes.join(" ")}` : body, truncated };
}

/**
 * A CSV parser that handles quotes, because the naive split does not.
 *
 * `line.split(",")` breaks on the first quoted comma, and a table that shifts
 * by one column halfway down is worse than no table — the model reads it as
 * data rather than as damage.
 */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

/**
 * How an extracted document is handed to the model.
 *
 * Truncation is stated rather than silent. A model that does not know it is
 * reading part of a contract will answer as though it read all of one, and the
 * user has no way to tell the difference.
 */
export function documentBlock(name: string, document: ExtractedDocument): string {
  const header = document.pages ? `${name} · ${document.pages} page${document.pages === 1 ? "" : "s"}` : name;
  return [
    `--- ${header} ---`,
    document.text,
    document.truncated
      ? "\n[This document was longer than the limit and has been cut here. Say so if the answer depends on what came after.]"
      : ""
  ].filter(Boolean).join("\n");
}
