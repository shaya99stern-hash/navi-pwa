import type { NaviPreferences, StoredChat } from "../ai/types";

/**
 * The client half of cloud memory: a write-through mirror of IndexedDB.
 *
 * IndexedDB stays the source the app renders from — it is synchronous with the
 * UI and works offline. This module trails behind it, pushing changed chats
 * and preferences up on a debounce and pulling the merged view down once per
 * launch. Every failure is silent by design: sync going down must cost the
 * mirror and nothing else.
 */

const PUSH_DEBOUNCE_MS = 4_000;
const MAX_BATCH = 12;
/** An embedded file above this is a photo, not conversation. The mirror drops
    it; the original stays intact in IndexedDB on the device that has it. */
const MAX_INLINE_DATA_URL_CHARS = 100_000;

let enabled = false;
/**
 * Set when the server has said, in effect, "not ever" — 503 because the
 * deployment has no cloud memory, or 401 because nobody is signed in.
 *
 * Without this the mirror asked again on every change, forever. Local
 * preferences were the only input to `enabled`, so a deployment with no
 * Supabase and a signed-out visitor both produced a doomed PUT every few
 * seconds for as long as the app was open — each one `keepalive`, which draws
 * on a small per-page budget shared with the requests that do matter. Nothing
 * surfaced it because every failure here is deliberately silent.
 *
 * A refusal is a fact about the deployment or the session, so it holds until
 * one of those changes: a successful pull clears it, which is exactly when
 * signing in or configuring the store would take effect.
 */
let refused = false;
const pendingChats = new Map<string, StoredChat>();
let pendingPreferences: NaviPreferences | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function setCloudSyncEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    pendingChats.clear();
    pendingPreferences = null;
  }
}

/** Is the mirror actually going to write? Exported for the settings screen. */
export function cloudSyncActive(): boolean {
  return enabled && !refused;
}

/* 503: this deployment has no store. 401: nobody is signed in. Both are
   settled answers rather than transient failures, and both come back the same
   way on the next request, so retrying is pure waste. A 5xx that is not 503,
   or a network error, stays retryable — those do resolve on their own. */
function noteResponse(response: Response): void {
  if (response.status === 503 || response.status === 401) refused = true;
}

/** Strip huge inline data URLs so a chat with photos still fits a jsonb row. */
export function compactChatForCloud(chat: StoredChat): StoredChat {
  return {
    ...chat,
    messages: chat.messages.map((message) => {
      if (!Array.isArray((message as { parts?: unknown }).parts)) return message;
      return {
        ...message,
        parts: (message as { parts: Array<Record<string, unknown>> }).parts.map((part) => {
          const url = part.url;
          if (typeof url === "string" && url.startsWith("data:") && url.length > MAX_INLINE_DATA_URL_CHARS) {
            return { ...part, url: "data:,omitted-from-sync" };
          }
          return part;
        })
      };
    })
  } as StoredChat;
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, PUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (!cloudSyncActive()) return;
  const chats = [...pendingChats.values()].slice(0, MAX_BATCH).map(compactChatForCloud);
  const preferences = pendingPreferences;
  pendingChats.clear();
  pendingPreferences = null;

  if (chats.length) {
    await fetch("/api/memory/chats", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chats }),
      keepalive: true
    }).then(noteResponse).catch(() => {});
  }
  /* Checked again: the chat push may have just learned the store is unusable,
     and sending the second request anyway would prove the same point twice. */
  if (preferences && !refused) {
    await fetch("/api/memory/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
      keepalive: true
    }).then(noteResponse).catch(() => {});
  }
}

export function queueChatPush(chat: StoredChat): void {
  if (!cloudSyncActive() || !chat.messages.length) return;
  pendingChats.set(chat.id, chat);
  schedule();
}

export function queuePreferencesPush(preferences: NaviPreferences): void {
  if (!cloudSyncActive()) return;
  pendingPreferences = preferences;
  schedule();
}

export function pushChatDeletion(chatId: string): void {
  if (!cloudSyncActive()) return;
  pendingChats.delete(chatId);
  void fetch(`/api/memory/chats?id=${encodeURIComponent(chatId)}`, { method: "DELETE", keepalive: true }).then(noteResponse).catch(() => {});
}

/* Backgrounding a PWA on iOS is how it closes; pagehide is the last chance
   for queued work to leave the device. */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (timer) { clearTimeout(timer); timer = null; }
    void flush();
  });
}

export type CloudPull = {
  chats: StoredChat[];
  preferences: Partial<NaviPreferences> | null;
};

/** The synced view, or null when sync is off, signed out, or unreachable. */
export async function pullCloudMemory(): Promise<CloudPull | null> {
  try {
    const [chatsResponse, preferencesResponse] = await Promise.all([
      fetch("/api/memory/chats", { cache: "no-store" }),
      fetch("/api/memory/preferences", { cache: "no-store" })
    ]);
    if (!chatsResponse.ok) return null;
    const chatsBody = (await chatsResponse.json()) as { configured?: boolean; chats?: StoredChat[] };
    if (!chatsBody.configured) return null;
    /* A store that answers is a store worth writing to. This is what lets a
       sign-in, or a deployment that gains its Supabase keys, revive a mirror
       an earlier refusal had switched off — without it, "sign in and it will
       sync" would be true only after a reload. */
    refused = false;
    const preferencesBody = preferencesResponse.ok
      ? ((await preferencesResponse.json()) as { preferences?: Partial<NaviPreferences> | null })
      : { preferences: null };
    return {
      chats: Array.isArray(chatsBody.chats) ? chatsBody.chats : [],
      preferences: preferencesBody.preferences ?? null
    };
  } catch {
    return null;
  }
}

/**
 * Merge the cloud view into the local one. Per chat id the newer copy wins;
 * chats only one side knows about survive. Deletion is not inferred — a chat
 * missing from the cloud is treated as not-yet-synced, never as deleted,
 * because guessing wrong there destroys someone's conversation.
 */
export function mergeCloudChats(local: StoredChat[], cloud: StoredChat[]): StoredChat[] {
  const byId = new Map<string, StoredChat>();
  for (const chat of cloud) byId.set(chat.id, chat);
  for (const chat of local) {
    const existing = byId.get(chat.id);
    if (!existing || chat.updatedAt >= existing.updatedAt) byId.set(chat.id, chat);
  }
  return [...byId.values()];
}
