/* PATH: lib/ai/navi-soul/artifact-quality.ts  — NEW FILE, copy verbatim. */

import { recoverArtifactPayload, validateArtifactPayload } from "../../security/artifacts";

/**
 * The difference between a valid artifact and a good one.
 *
 * `lib/security/artifacts.ts` answers "is this payload safe and well-formed";
 * the artifact gate answers "did the fence close". Neither answers the failure
 * users actually report: the card renders, and what is inside it is broken —
 * a page whose body is empty, code that stops mid-expression because the
 * stream was cut, a component importing a package the artifact runtime does
 * not provide. All of that passes validation, because validation was never
 * asked about it.
 *
 * Every check here is deterministic and local — string reads, zero tokens.
 * The split between blocking and noting is deliberate: a check blocks only
 * when the artifact is unmistakably unusable, because a false block throws
 * away real work; everything merely suspicious becomes a note the chat route
 * can log or fold into one retry instruction.
 */

export type ArtifactVerdict =
  | { ok: true; payload: unknown; repaired: boolean; notes: string[] }
  | { ok: false; error: string; notes: string[] };

/** Content shorter than this is a stub, whatever the JSON around it says. */
const CONTENT_FLOOR = 40;

/** The fields an artifact's renderable content is known to live in. */
const CONTENT_FIELDS = ["html", "code", "content", "markup", "source"] as const;

function renderableContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const field of CONTENT_FIELDS) {
    if (typeof record[field] === "string" && (record[field] as string).length) return record[field] as string;
  }
  return null;
}

/**
 * Signs the stream was cut mid-payload but the JSON still closed — the model
 * ran out of output budget and emitted a hasty `"}` to finish the fence.
 * These are the artifacts that render as half a page with no error anywhere.
 */
export function truncationSuspect(content: string): string | null {
  const trimmed = content.trimEnd();
  if (/<[a-zA-Z][^>]{0,80}$/.test(trimmed)) return "ends in the middle of an opening tag";
  if (/[,({\[]\s*$/.test(trimmed)) return "ends on a dangling bracket or comma";
  if (/(?:=>|&&|\|\||[+\-*/%=]|\breturn|\bconst|\blet|\bvar)\s*$/.test(trimmed)) return "ends mid-expression";
  const backticks = (content.match(/`/g) ?? []).length;
  if (backticks % 2 === 1) return "has an unterminated template literal";
  return null;
}

/** Structural smells worth a note, never a block — JSX and self-closing tags make exact counts unreliable. */
export function lintArtifactContent(content: string): string[] {
  const notes: string[] = [];
  for (const tag of ["div", "section", "main", "ul", "table"]) {
    const opens = (content.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
    const closes = (content.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
    if (Math.abs(opens - closes) > 3) {
      notes.push(`unbalanced <${tag}> tags (${opens} open, ${closes} close)`);
      break;
    }
  }
  const bareImport = /(?:^|\n)\s*import\s+[^"'\n]+["']((?!react)(?!\.)[a-z@][^"']*)["']/.exec(content);
  if (bareImport) notes.push(`imports "${bareImport[1]}", which the artifact runtime may not provide`);
  if (/\b(localStorage|sessionStorage)\b/.test(content)) {
    notes.push("uses web storage, which the sandboxed frame may block — prefer in-memory state");
  }
  return notes;
}

/**
 * Assess a completed fence body: parse or salvage it, then judge the content.
 * Called by the gate (or the route) once, after `CLOSE` — never mid-stream.
 */
export function assessArtifact(inner: string): ArtifactVerdict {
  let payload: unknown = null;
  let repaired = false;

  try {
    const parsed = JSON.parse(inner) as unknown;
    if (validateArtifactPayload(parsed).ok) payload = parsed;
  } catch {
    /* fall through to salvage */
  }
  if (payload === null) {
    const recovered = recoverArtifactPayload(inner);
    if (!recovered.ok) return { ok: false, error: recovered.error ?? "The payload could not be salvaged.", notes: [] };
    payload = recovered.payload;
    repaired = true;
  }

  const content = renderableContent(payload);
  if (content === null) {
    /* No known content field is not a defect — some artifact kinds carry data,
       not markup. Nothing to lint means nothing to block on. */
    return { ok: true, payload, repaired, notes: [] };
  }

  if (content.trim().length < CONTENT_FLOOR) {
    return { ok: false, error: "The artifact's content is empty or a stub.", notes: [] };
  }
  const cut = truncationSuspect(content);
  if (cut) {
    return { ok: false, error: `The artifact appears truncated: it ${cut}.`, notes: [] };
  }

  return { ok: true, payload, repaired, notes: lintArtifactContent(content) };
}

/**
 * One line for the single cheap repair pass the route may spend on a blocked
 * artifact. An instruction, not a conversation: the retry gets the original
 * request, this line, and nothing else — and it runs on a fast free route,
 * because regenerating a truncated payload is mechanical work.
 */
export function retryInstruction(verdict: ArtifactVerdict): string | null {
  if (verdict.ok) return null;
  return `The previous artifact was rejected: ${verdict.error} Emit the complete artifact again in one fence, shorter if needed, finishing every tag and expression.`;
}
