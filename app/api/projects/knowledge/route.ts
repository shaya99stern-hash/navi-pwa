import { csvToMarkdown, extractPdfText } from "@/lib/ai/document-text";

/**
 * Turn an uploaded file into project knowledge.
 *
 * Projects carried a name, instructions, and typed notes — which made them a
 * system prompt with a label. The thing people actually want from a project is
 * to put the documents in it once and stop re-attaching them to every chat.
 *
 * Extraction happens here rather than on the device because the app already
 * has this exact pipeline for chat attachments, and two implementations of
 * "read a PDF" would drift the first time one was fixed. What is stored is the
 * *text*, never the file: a project is carried into every conversation that
 * uses it, and carrying megabytes of PDF into a request that only needs its
 * words is how the token budget gets blown from a direction nobody is
 * watching.
 *
 * Edge, matching the chat route it borrows from — `unpdf` runs there, which is
 * already proven by attachments working today.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Ten megabytes of encoded upload.
 *
 * The limit is on what is read, not on what is kept: a long PDF reduces to a
 * few thousand characters of text, and the request body is the only part of
 * this that is ever large.
 */
const MAX_UPLOAD_CHARS = 10_000_000;
/**
 * What one document may contribute to a project.
 *
 * A project's whole knowledge base has to fit alongside the system prompt, the
 * tool schemas and the conversation, on a free tier where the entire allowance
 * can be 8,000 tokens. Truncating here — once, visibly, at upload — is far
 * better than discovering it per request, which is exactly the failure that
 * took this app down.
 */
const MAX_DOCUMENT_CHARS = 12_000;

type Extracted = { title: string; text: string; truncated: boolean };

function respond(body: Extracted | { error: string }, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function POST(request: Request): Promise<Response> {
  let body: { name?: unknown; mediaType?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Expected a JSON body." }, 400);
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Document";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  const data = typeof body.data === "string" ? body.data : "";
  if (!data) return respond({ error: "No file was supplied." }, 400);
  if (data.length > MAX_UPLOAD_CHARS) return respond({ error: "That file is too large to read. Try one under about 7 MB." }, 413);

  let text = "";
  try {
    if (mediaType === "application/pdf") {
      const extracted = await extractPdfText(decodeBase64(data));
      /* A scan has no text layer, and there is nothing useful to store for
         one. Saying so is better than saving an empty knowledge item that
         silently contributes nothing to every future conversation. */
      if (!extracted?.text.trim()) return respond({ error: "That PDF has no text in it — it may be a scan. Try a text-based PDF." }, 422);
      text = extracted.text;
    } else if (mediaType === "text/csv") {
      text = csvToMarkdown(new TextDecoder().decode(decodeBase64(data))).text;
    } else if (mediaType.startsWith("text/") || mediaType === "application/json" || mediaType === "application/xml") {
      text = new TextDecoder().decode(decodeBase64(data));
    } else {
      return respond({ error: "That file type cannot be read as text. PDF, CSV, JSON, and plain text work." }, 415);
    }
  } catch (error) {
    console.warn("Navi Soul could not read a project document:", error);
    return respond({ error: "That file could not be read." }, 422);
  }

  const collapsed = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!collapsed) return respond({ error: "That file had no readable text in it." }, 422);

  const truncated = collapsed.length > MAX_DOCUMENT_CHARS;
  return respond({ title: name, text: truncated ? collapsed.slice(0, MAX_DOCUMENT_CHARS) : collapsed, truncated });
}
