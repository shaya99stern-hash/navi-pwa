import type { NaviPreferences, StoredChat } from "../ai/types";
import { DEFAULT_PREFERENCES, sortChats } from "../chat";

const DB_NAME = "navi-local-v3";
const DB_VERSION = 1;
const STORE = "state";

export type LocalState = {
  chats: StoredChat[];
  preferences: NaviPreferences;
  draft: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open Navi local storage."));
  });
}

export async function getLocalValue<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${key}.`));
    transaction.oncomplete = () => database.close();
  });
}

export async function setLocalValue<T>(key: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not write ${key}.`));
  });
  database.close();
}

export async function clearLocalState(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear Navi local data."));
  });
  database.close();
}

function mergePreferences(value?: Partial<NaviPreferences>): NaviPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    tools: { ...DEFAULT_PREFERENCES.tools, ...(value?.tools ?? {}) },
    connectedMcpServers: Array.isArray(value?.connectedMcpServers) ? value.connectedMcpServers : []
  };
}

function migrateLegacyState(): Partial<LocalState> {
  try {
    const rawChats = localStorage.getItem("navi.chats.v2");
    const rawPreferences = localStorage.getItem("navi.preferences.v2");
    const legacyChats = rawChats ? (JSON.parse(rawChats) as Array<Partial<StoredChat>>) : [];
    const legacyPreferences = rawPreferences ? (JSON.parse(rawPreferences) as Record<string, unknown>) : {};
    const chats = legacyChats
      .filter((chat) => typeof chat.id === "string" && Array.isArray(chat.messages))
      .map((chat) => ({
        id: chat.id as string,
        title: typeof chat.title === "string" ? chat.title : "New chat",
        preview: typeof chat.preview === "string" ? chat.preview : "Saved conversation",
        updatedAt: typeof chat.updatedAt === "number" ? chat.updatedAt : Date.now(),
        pinned: Boolean(chat.pinned),
        messages: chat.messages ?? []
      }));

    const presetMap: Record<string, NaviPreferences["preset"]> = {
      auto: "auto",
      "openrouter-free": "openrouter-free",
      "groq-fast": "groq-fast",
      "groq-balanced": "fable-5",
      "groq-reasoning": "opus-4-8"
    };

    return {
      chats: sortChats(chats),
      preferences: mergePreferences({
        preset: presetMap[String(legacyPreferences.route ?? "auto")] ?? "auto",
        style: (legacyPreferences.style as NaviPreferences["style"]) ?? "balanced",
        saveHistory: typeof legacyPreferences.saveHistory === "boolean" ? legacyPreferences.saveHistory : true
      })
    };
  } catch {
    return {};
  }
}

export async function loadLocalState(): Promise<LocalState> {
  const [storedChats, storedPreferences, storedDraft] = await Promise.all([
    getLocalValue<StoredChat[]>("chats"),
    getLocalValue<NaviPreferences>("preferences"),
    getLocalValue<string>("draft")
  ]);

  if (!storedChats && !storedPreferences) {
    const migrated = migrateLegacyState();
    if (migrated.chats) await setLocalValue("chats", migrated.chats);
    if (migrated.preferences) await setLocalValue("preferences", migrated.preferences);
    return {
      chats: migrated.chats ?? [],
      preferences: mergePreferences(migrated.preferences),
      draft: storedDraft ?? ""
    };
  }

  return {
    chats: sortChats(storedChats ?? []),
    preferences: mergePreferences(storedPreferences),
    draft: storedDraft ?? ""
  };
}
