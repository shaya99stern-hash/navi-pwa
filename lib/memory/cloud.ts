import "server-only";
import type { StoredChat } from "../ai/types";

/**
 * Cloud memory: conversations and preferences that follow the person.
 *
 * Chats used to live only in IndexedDB on one phone, which meant a new device
 * started from nothing and a cleared browser lost everything. These calls
 * mirror them into Supabase under the same contract as remembered facts: the
 * caller's own Clerk token is what row-level security keys on, so this module
 * never needs a service role and cannot reach another person's rows.
 *
 * Reached over PostgREST for the same reason facts are — a handful of HTTP
 * calls against three tables needs no client library, and the security that
 * matters is enforced in the database.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const CHATS_TABLE = "navi_chats";
const PREFERENCES_TABLE = "navi_preferences";
/** Enough history for real use without turning a pull into a megabyte fetch. */
const MAX_CLOUD_CHATS = 200;
/** A chat above this carries embedded files, not conversation. Skip, keep the rest. */
const MAX_CHAT_PAYLOAD_BYTES = 700_000;

export function cloudMemoryConfigured(): boolean {
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
 * One request to PostgREST, carrying the caller's own Clerk token. Memory is
 * an enhancement, never a precondition: any failure is a null, not an error
 * the user has to see — but it is logged, because a failure nobody can see is
 * one nobody fixes.
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
    if (!response.ok) {
      /* Still a null to the caller — memory is an enhancement and the user
         should not be shown a database error. But swallowing it in silence is
         how cloud memory sat broken for a week with the app reporting nothing
         at all: a 401 from an expired third-party auth registration, a 404
         from a missing table, and a 403 from a policy that refuses the row all
         arrived here as the same quiet null. The status code alone separates
         all three, and the body carries PostgREST's own reason. */
      console.warn(`Cloud memory ${init.method ?? "GET"} ${path} answered ${response.status}: ${await response.text().catch(() => "")}`.trim());
      return null;
    }
    if (response.status === 204) return "ok";
    return await response.json();
  } catch (error) {
    /* An abort is the timeout above doing its job, not a fault worth a line
       in the log on every slow network. */
    if (error instanceof Error && error.name === "AbortError") return null;
    console.warn(`Cloud memory ${init.method ?? "GET"} ${path} never completed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type ChatRow = { chat_id: string; updated_at: string; payload: unknown };

function toStoredChat(row: ChatRow): StoredChat | null {
  const payload = row.payload as Partial<StoredChat> | null;
  if (!payload || typeof payload.id !== "string" || !Array.isArray(payload.messages)) return null;
  return {
    id: payload.id,
    title: typeof payload.title === "string" ? payload.title : "New chat",
    preview: typeof payload.preview === "string" ? payload.preview : "",
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.parse(row.updated_at) || Date.now(),
    pinned: Boolean(payload.pinned),
    summary: typeof payload.summary === "string" ? payload.summary : undefined,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
    projectId: typeof payload.projectId === "string" ? payload.projectId : undefined,
    connectorAccessMode: payload.connectorAccessMode,
    ratings: payload.ratings,
    messages: payload.messages
  };
}

/** This person's synced conversations, newest first. */
export async function listCloudChats(clerkToken: string): Promise<StoredChat[]> {
  const rows = await request(
    clerkToken,
    `${CHATS_TABLE}?select=chat_id,updated_at,payload&order=updated_at.desc&limit=${MAX_CLOUD_CHATS}`
  );
  if (!Array.isArray(rows)) return [];
  return (rows as ChatRow[]).map(toStoredChat).filter((chat): chat is StoredChat => chat !== null);
}

/**
 * Mirror chats up. Oversized ones are skipped rather than failing the batch —
 * a chat full of embedded images should not stop the rest from syncing.
 */
export async function upsertCloudChats(clerkToken: string, userId: string, chats: StoredChat[]): Promise<boolean> {
  const rows = chats
    .filter((chat) => chat.id && Array.isArray(chat.messages) && chat.messages.length)
    .map((chat) => ({
      user_id: userId,
      chat_id: chat.id,
      title: chat.title.slice(0, 300),
      preview: chat.preview.slice(0, 500),
      pinned: chat.pinned,
      summary: chat.summary?.slice(0, 4_000) ?? null,
      project_id: chat.projectId ?? null,
      updated_at: new Date(chat.updatedAt || Date.now()).toISOString(),
      payload: chat
    }))
    .filter((row) => JSON.stringify(row.payload).length <= MAX_CHAT_PAYLOAD_BYTES);
  if (!rows.length) return false;

  const result = await request(clerkToken, `${CHATS_TABLE}?on_conflict=user_id,chat_id`, {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal"
  });
  return result !== null;
}

export async function deleteCloudChat(clerkToken: string, chatId: string): Promise<boolean> {
  if (!chatId || chatId.length > 100) return false;
  const result = await request(clerkToken, `${CHATS_TABLE}?chat_id=eq.${encodeURIComponent(chatId)}`, {
    method: "DELETE"
  });
  return result !== null;
}

export async function getCloudPreferences(clerkToken: string): Promise<Record<string, unknown> | null> {
  const rows = await request(clerkToken, `${PREFERENCES_TABLE}?select=payload,updated_at&limit=1`);
  if (!Array.isArray(rows) || !rows.length) return null;
  const payload = (rows[0] as { payload?: unknown }).payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

export async function putCloudPreferences(clerkToken: string, userId: string, payload: Record<string, unknown>): Promise<boolean> {
  const result = await request(clerkToken, `${PREFERENCES_TABLE}?on_conflict=user_id`, {
    method: "POST",
    body: { user_id: userId, payload, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal"
  });
  return result !== null;
}
