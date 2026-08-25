import "server-only";

import { readPostgrestPayload } from "./postgrest-response";

/**
 * Durable facts, remembered across conversations.
 *
 * This is the one thing in Phase D that genuinely needed a server. Recall and
 * search read conversations that are already on the device; a *fact* has to
 * outlive the conversation that produced it and follow the person, which
 * IndexedDB on one phone cannot do.
 *
 * Conversations themselves stay local. The Privacy and Account screens promise
 * "this device only", the app works offline because of it, and nothing here
 * changes that — only what was distilled from a chat is stored, never the chat.
 *
 * Reached over PostgREST rather than through `@supabase/supabase-js`: the only
 * operations are four HTTP calls against one table, and the row-level security
 * that matters is enforced in the database regardless of which client speaks to
 * it. A dependency would add a bundle and a version to track for no authority
 * this module does not already have.
 */

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_FACTS = 60;
const MAX_FACT_CHARS = 500;
const TABLE = "navi_memory_facts";

export type MemoryFact = {
  id: string;
  fact: string;
  sourceChatId: string | null;
  updatedAt: string;
};

export function factsConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

function supabaseUrl(): string | undefined {
  const value = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  return value.startsWith("https://") ? value.replace(/\/+$/, "") : undefined;
}

function supabaseKey(): string | undefined {
  const value = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? ""
  ).trim();
  return value || undefined;
}

/**
 * Which credentials are missing, for the deployment log.
 *
 * Half-configured storage fails on write rather than at startup, which reads as
 * memory silently not working. Naming the gap is what turns that into something
 * a person can act on — the same reason the Clerk gap is described rather than
 * merely counted.
 */
export function describeFactsConfigGap(): string | null {
  const missing = [
    supabaseUrl() ? null : "NEXT_PUBLIC_SUPABASE_URL (must start with https://)",
    supabaseKey() ? null : "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  ].filter(Boolean);
  if (!missing.length) return null;
  return `Remembered facts are off; storage is not configured. Missing: ${missing.join(" and ")}.`;
}

/**
 * One request to PostgREST, carrying the caller's own Clerk token.
 *
 * The token is what row-level security keys on, so this module never needs a
 * service role and cannot read another person's rows even if asked to. A bug
 * here is a failed request, not a data leak.
 */
async function request(
  clerkToken: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
  onFailure?: (reason: string) => void
): Promise<unknown> {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    onFailure?.("Cloud memory is not configured on this deployment (no Supabase URL or key).");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${clerkToken}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      /* The same three failures `learned-skills.ts` already names, because this
         module has exactly the same ones and used to report none of them: a
         bare `return null` that made "the table was never created" and "the
         write succeeded and there was nothing to return" the same value.

         404: the table is not there. Until this commit there was no migration
         for `navi_memory_facts` in the repository at all, so a deployment that
         followed the repo has never had one.

         401/403: the table exists and Supabase does not trust the Clerk token.
         `auth.jwt() ->> 'sub'` evaluates to null, every policy compares against
         null, and every read and write is refused — indistinguishable from a
         missing table unless the status code is actually read. */
      onFailure?.(response.status === 404
        ? `The ${TABLE} table does not exist on this Supabase project — the migration in supabase/migrations has not been applied. (404: ${detail || "not found"})`
        : response.status === 401 || response.status === 403
          ? `Supabase rejected the request as unauthorised (${response.status}). The table exists, so this is almost certainly the Clerk token not being trusted: add Clerk as a third-party auth provider in the Supabase project, or every policy will compare against a null user and refuse everything. (${detail || "no detail"})`
          : `Supabase refused the request: ${response.status}${detail ? ` ${detail}` : ""}`);
      return null;
    }
    return await readPostgrestPayload(response);
  } catch (error) {
    /* Memory is an enhancement, never a precondition. A storage outage must
       cost the recalled context and nothing else — an answer without a
       remembered preference is worth far more than an error card. What changed
       is that the failure is now *reported* on the way past, so diagnostics can
       say what happened instead of the model guessing at it. */
    onFailure?.(error instanceof Error && error.name === "AbortError"
      ? "Cloud memory timed out."
      : `Cloud memory could not be reached: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Row = { id: string; fact: string; source_chat_id: string | null; updated_at: string };

function toFact(row: Row): MemoryFact {
  return { id: row.id, fact: row.fact, sourceChatId: row.source_chat_id, updatedAt: row.updated_at };
}

/** This person's facts, newest first. Empty when storage is off or unreachable. */
export async function listFacts(
  clerkToken: string,
  onFailure?: (reason: string) => void
): Promise<MemoryFact[]> {
  const rows = await request(
    clerkToken,
    `${TABLE}?select=id,fact,source_chat_id,updated_at&order=updated_at.desc&limit=${MAX_FACTS}`,
    {},
    onFailure
  );
  return Array.isArray(rows) ? (rows as Row[]).map(toFact) : [];
}

/**
 * Remember a fact, or leave the existing one alone if it is already known.
 *
 * `user_id` is sent explicitly and must equal the token's subject, or the
 * insert policy rejects it — so a caller cannot write into someone else's
 * memory by passing a different id.
 */
export async function rememberFact(
  clerkToken: string,
  userId: string,
  fact: string,
  sourceChatId?: string,
  onFailure?: (reason: string) => void
): Promise<MemoryFact | null> {
  const text = fact.trim().slice(0, MAX_FACT_CHARS);
  if (!text) return null;

  const rows = await request(clerkToken, `${TABLE}?on_conflict=user_id,fact`, {
    method: "POST",
    body: { user_id: userId, fact: text, source_chat_id: sourceChatId ?? null },
    /* `merge-duplicates` against `unique (user_id, fact)`, so saying the same
       thing twice refreshes the fact rather than accumulating it.

       That index is case-*sensitive*, and this comment claimed the opposite for
       as long as the table had no migration to check the claim against. ON
       CONFLICT can only use an index covering exactly the columns named in
       `on_conflict`, so a `lower(fact)` index would not be targetable here — it
       would fail every write rather than fold case. The live cost is small and
       real: "Ships on Tuesdays" and "ships on Tuesdays" become two rows. */
    prefer: "resolution=merge-duplicates,return=representation"
  }, onFailure);
  const row = Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
  return row ? toFact(row) : null;
}

/** Forget one fact. Returns whether the request was accepted. */
export async function forgetFact(clerkToken: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/rest/v1/${TABLE}?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${clerkToken}` },
      cache: "no-store"
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The characters remembered facts may spend in a prompt.
 *
 * There was no limit at all. `listFacts` returns up to sixty rows and each may
 * be five hundred characters, so this block could reach thirty thousand
 * characters — roughly seven and a half thousand tokens — unconditionally, on
 * every turn, on free routes whose whole request ceiling is eight thousand.
 * And it sits inside the non-optional `turn` block, so the payload preflight
 * cannot drop it: faced with an oversized request it deletes conversation
 * history instead. The app would forget what was just said in order to keep
 * repeating what it once learned.
 */
const PROMPT_BUDGET_CHARS = 4_000;

/** Render remembered facts for the prompt. Empty string when there are none. */
export function factsBlock(facts: MemoryFact[]): string {
  if (!facts.length) return "";

  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const entry of facts) {
    const line = `- ${entry.fact}`;
    /* Newest first from the query, so a full budget drops the oldest — and
       says how many, rather than quietly shortening the user's memory. */
    if (used + line.length > PROMPT_BUDGET_CHARS) { omitted += 1; continue; }
    kept.push(line);
    used += line.length;
  }

  return [
    "Durable facts this user has established about themselves across past conversations.",
    "Treat these as current unless this conversation contradicts them, and never present one back as though it were just discovered.",
    "",
    ...kept,
    ...(omitted
      ? ["", `[${omitted} older ${omitted === 1 ? "fact is" : "facts are"} stored but did not fit this turn. Do not claim the list above is everything you remember about them.]`]
      : [])
  ].join("\n");
}
