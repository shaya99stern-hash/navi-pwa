import "server-only";

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
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<unknown> {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return null;

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
    if (!response.ok) return null;
    if (response.status === 204) return null;
    return await response.json();
  } catch {
    /* Memory is an enhancement, never a precondition. A storage outage must
       cost the recalled context and nothing else — an answer without a
       remembered preference is worth far more than an error card. */
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
export async function listFacts(clerkToken: string): Promise<MemoryFact[]> {
  const rows = await request(
    clerkToken,
    `${TABLE}?select=id,fact,source_chat_id,updated_at&order=updated_at.desc&limit=${MAX_FACTS}`
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
  sourceChatId?: string
): Promise<MemoryFact | null> {
  const text = fact.trim().slice(0, MAX_FACT_CHARS);
  if (!text) return null;

  const rows = await request(clerkToken, `${TABLE}?on_conflict=user_id,fact`, {
    method: "POST",
    body: { user_id: userId, fact: text, source_chat_id: sourceChatId ?? null },
    /* `merge-duplicates` against the case-insensitive unique index, so saying
       the same thing twice refreshes the fact rather than accumulating it. */
    prefer: "resolution=merge-duplicates,return=representation"
  });
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

/** Render remembered facts for the prompt. Empty string when there are none. */
export function factsBlock(facts: MemoryFact[]): string {
  if (!facts.length) return "";
  return [
    "Durable facts this user has established about themselves across past conversations.",
    "Treat these as current unless this conversation contradicts them, and never present one back as though it were just discovered.",
    "",
    ...facts.map((entry) => `- ${entry.fact}`)
  ].join("\n");
}
