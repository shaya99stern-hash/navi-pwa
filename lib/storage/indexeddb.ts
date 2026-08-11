import type { ConnectorAccessMode, NaviMode, NaviPreferences, NaviProject, StoredChat } from "../ai/types";
import { DEFAULT_PREFERENCES, effortFromLegacyStyle, sortChats } from "../chat";

const DB_NAME = "navi-local-v3";
const DB_VERSION = 1;
const STORE = "state";
const STORAGE_SCOPE_KEY = "navi.storage.scope.v1";
const LEGACY_OWNER_KEY = "navi.storage.legacy-owner.v1";
const KNOWN_STATE_KEYS = ["chats", "preferences", "draft", "projects", "activeProjectId"] as const;

type PreferenceInput = Partial<NaviPreferences> & { preset?: unknown };

export type LocalState = {
  chats: StoredChat[];
  preferences: NaviPreferences;
  draft: string;
  projects: NaviProject[];
  activeProjectId: string | null;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open NaviOS local storage."));
  });
}

export type StorageDurability = "persisted" | "best-effort" | "unavailable";

/**
 * Every chat, project, and draft lives only in IndexedDB on this device. Under
 * the default best-effort policy the browser may evict all of it — WebKit
 * clears script-writable storage after seven days without a visit — so ask for
 * durable storage. Installed PWAs are usually granted it without a prompt.
 */
export async function requestPersistentStorage(): Promise<StorageDurability> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return "unavailable";
  try {
    if (await navigator.storage.persisted?.()) return "persisted";
    return (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "unavailable";
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

function currentScope(): string {
  if (typeof localStorage === "undefined") return "guest";
  return localStorage.getItem(STORAGE_SCOPE_KEY)?.trim() || "guest";
}

function scopedKey(key: string, scope = currentScope()): string {
  return `${scope}::${key}`;
}

async function getRawValue<T>(key: string): Promise<T | undefined> {
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

async function setRawValue<T>(key: string, value: T): Promise<void> {
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

async function deleteRawValue(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not delete ${key}.`));
  });
  database.close();
}

export async function getLocalValue<T>(key: string): Promise<T | undefined> {
  return getRawValue<T>(scopedKey(key));
}

export async function setLocalValue<T>(key: string, value: T): Promise<void> {
  return setRawValue(scopedKey(key), value);
}

export async function clearLocalState(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const scope = currentScope();
  const prefix = `${scope}::`;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear NaviOS local data."));
  });
  database.close();

  if (typeof localStorage !== "undefined" && localStorage.getItem(LEGACY_OWNER_KEY) === scope) {
    localStorage.removeItem("navi.chats.v2");
    localStorage.removeItem("navi.preferences.v2");
  }
}

async function migrateUnscopedIndexedDbState(): Promise<void> {
  if (typeof localStorage === "undefined" || typeof indexedDB === "undefined") return;
  const scope = currentScope();
  if (localStorage.getItem(LEGACY_OWNER_KEY) !== scope) return;

  const marker = `navi.storage.migrated.v1:${scope}`;
  if (localStorage.getItem(marker) === "1") return;

  for (const key of KNOWN_STATE_KEYS) {
    const existing = await getRawValue(scopedKey(key, scope));
    const legacy = await getRawValue(key);
    if (existing === undefined && legacy !== undefined) {
      await setRawValue(scopedKey(key, scope), legacy);
    }
    if (legacy !== undefined) await deleteRawValue(key);
  }

  localStorage.setItem(marker, "1");
}

/* v4.2.0 shipped a model picker. v4.3.0 has one brain and two modes, so every
   stored preset collapses to the mode it was really expressing. Anyone on Code
   keeps Code; everyone else lands on Chat. Nobody is left unset. */
/* Every key here is a string some device actually wrote to its own storage, so
   these are historical records and not names this app still chooses. Renaming
   one to match current naming would simply stop matching what is on the disk
   it was written to, and that user would silently lose their mode. They are
   spelled the way they were stored, permanently. */
const LEGACY_PRESET_TO_MODE: Record<string, NaviMode> = {
  "navi-code": "code",
  "navi-fable": "code",
  "navi-soul-deep": "code",
  "navi-soul": "chat",
  "navi-sol": "chat",
  "navi-soul-direct": "chat",
  "navi-chat": "chat",
  auto: "chat",
  "gemini-direct": "chat",
  "groq-direct": "chat",
  "huggingface-direct": "chat",
  // Presets retired before v4.2.0, still on devices that have not opened since.
  "navi-5": "code",
  "fable-5": "code",
  "navi-sol-5-6": "chat",
  "opus-4-8": "chat",
  "groq-balanced": "chat",
  "groq-reasoning": "chat",
  "groq-fast": "chat",
  "gemini-flash": "chat",
  "openrouter-free": "chat"
};

function normalizeMode(value: unknown, legacyPreset: unknown): NaviMode {
  // A v4.3.0 preference already carries a mode; trust it before the fallback.
  if (value === "chat" || value === "code") return value;
  return LEGACY_PRESET_TO_MODE[String(legacyPreset ?? "")] ?? "chat";
}


function normalizeConnectorMode(value: unknown): ConnectorAccessMode {
  return value === "auto" || value === "always" ? value : "ask";
}

const MENU_SECTIONS = ["general", "account", "privacy", "capabilities", "connectors", "skills", "playbooks", "developer"] as const;
const EFFORTS = ["low", "medium", "high"] as const;
/** The scale was briefly five levels; fold the retired top two into High. */
const RETIRED_EFFORTS: Record<string, NaviPreferences["effort"]> = { extra: "high", max: "high" };

function mergePreferences(value?: PreferenceInput): NaviPreferences {
  const stored = value as Partial<NaviPreferences> | undefined;
  const profile = stored?.profile;
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    mode: normalizeMode((value as { mode?: unknown } | undefined)?.mode, value?.preset),
    // Pre-effort clients stored a three-way response style; carry it forward.
    effort: EFFORTS.includes(stored?.effort as (typeof EFFORTS)[number])
      ? (stored?.effort as NaviPreferences["effort"])
      : RETIRED_EFFORTS[String(stored?.effort ?? "")] ?? effortFromLegacyStyle(stored?.style),
    chatFont: stored?.chatFont === "sans" ? "sans" : "serif",
    memory: stored?.memory !== false,
    customPlaybooks: Array.isArray(stored?.customPlaybooks)
      ? stored.customPlaybooks
        .filter((entry): entry is NaviPreferences["customPlaybooks"][number] =>
          Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.instructions === "string"))
        .slice(0, 40)
      : [],
    notifyOnComplete: stored?.notifyOnComplete === true,
    voiceLanguage: typeof stored?.voiceLanguage === "string" && stored.voiceLanguage
      ? stored.voiceLanguage
      : readLegacyVoiceLanguage(),
    profile: {
      fullName: typeof profile?.fullName === "string" ? profile.fullName : "",
      displayName: typeof profile?.displayName === "string" ? profile.displayName : "",
      work: typeof profile?.work === "string" ? profile.work : "",
      instructions: typeof profile?.instructions === "string" ? profile.instructions.slice(0, 4_000) : ""
    },
    tools: { ...DEFAULT_PREFERENCES.tools, ...(value?.tools ?? {}) },
    connectedMcpServers: Array.isArray(value?.connectedMcpServers) ? value.connectedMcpServers : [],
    customConnectors: Array.isArray(stored?.customConnectors)
      ? stored.customConnectors
        .filter((entry): entry is NaviPreferences["customConnectors"][number] =>
          Boolean(entry && typeof entry === "object"
            && typeof entry.id === "string"
            && typeof entry.name === "string"
            && typeof entry.baseUrl === "string"
            && typeof entry.apiKey === "string"
            && ["openai", "anthropic", "supabase", "mcp"].includes(entry.kind)))
        .slice(0, 12)
      : [],
    connectorAccessMode: normalizeConnectorMode(value?.connectorAccessMode),
    // Old section names ("models", "system", …) no longer exist.
    lastMenuSection: MENU_SECTIONS.includes(stored?.lastMenuSection as (typeof MENU_SECTIONS)[number])
      ? (stored?.lastMenuSection as NaviPreferences["lastMenuSection"])
      : "general"
  };
}

/** The voice language predates preferences and lived in its own localStorage key. */
function readLegacyVoiceLanguage(): string {
  try {
    return localStorage.getItem("navi.voice.language.v1") || "auto";
  } catch {
    return "auto";
  }
}

function normalizeProjects(value: unknown): NaviProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<NaviProject>((item) => {
    if (!item || typeof item !== "object") return [];
    const project = item as Partial<NaviProject>;
    if (typeof project.id !== "string" || typeof project.name !== "string") return [];
    const createdAt = typeof project.createdAt === "number" ? project.createdAt : Date.now();
    const syncState: NaviProject["syncState"] = project.syncState === "synced" || project.syncState === "attention"
      ? project.syncState
      : "local";
    return [{
      id: project.id,
      name: project.name,
      instructions: typeof project.instructions === "string" ? project.instructions : "",
      knowledge: Array.isArray(project.knowledge) ? project.knowledge.filter((entry): entry is string => typeof entry === "string").slice(0, 100) : [],
      createdAt,
      updatedAt: typeof project.updatedAt === "number" ? project.updatedAt : createdAt,
      syncState
    }];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function migrateLegacyState(): Partial<LocalState> {
  try {
    const scope = currentScope();
    if (localStorage.getItem(LEGACY_OWNER_KEY) !== scope) return {};
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
        summary: typeof chat.summary === "string" ? chat.summary : undefined,
        attachments: Array.isArray(chat.attachments) ? chat.attachments : undefined,
        projectId: typeof chat.projectId === "string" ? chat.projectId : undefined,
        connectorAccessMode: normalizeConnectorMode(chat.connectorAccessMode),
        messages: chat.messages ?? []
      }));

    return {
      chats: sortChats(chats),
      preferences: mergePreferences({
        preset: legacyPreferences.preset ?? legacyPreferences.route,
        style: (legacyPreferences.style as NaviPreferences["style"]) ?? "balanced",
        saveHistory: typeof legacyPreferences.saveHistory === "boolean" ? legacyPreferences.saveHistory : true
      }),
      projects: [],
      activeProjectId: null
    };
  } catch {
    return {};
  }
}

export async function loadLocalState(): Promise<LocalState> {
  await migrateUnscopedIndexedDbState();
  const [storedChats, storedPreferences, storedDraft, storedProjects, storedActiveProjectId] = await Promise.all([
    getLocalValue<StoredChat[]>("chats"),
    getLocalValue<NaviPreferences>("preferences"),
    getLocalValue<string>("draft"),
    getLocalValue<NaviProject[]>("projects"),
    getLocalValue<string | null>("activeProjectId")
  ]);

  if (!storedChats && !storedPreferences) {
    const migrated = migrateLegacyState();
    if (migrated.chats) await setLocalValue("chats", migrated.chats);
    if (migrated.preferences) await setLocalValue("preferences", migrated.preferences);
    if (migrated.chats || migrated.preferences) {
      localStorage.removeItem("navi.chats.v2");
      localStorage.removeItem("navi.preferences.v2");
    }
    return {
      chats: migrated.chats ?? [],
      preferences: mergePreferences(migrated.preferences),
      draft: storedDraft ?? "",
      projects: normalizeProjects(storedProjects ?? migrated.projects),
      activeProjectId: storedActiveProjectId ?? migrated.activeProjectId ?? null
    };
  }

  const normalizedPreferences = mergePreferences(storedPreferences);
  /* Persist immediately when normalisation changed anything, so a v4.2.0
     device is migrated on first open rather than on first settings change. */
  if (storedPreferences?.mode !== normalizedPreferences.mode || storedPreferences?.connectorAccessMode !== normalizedPreferences.connectorAccessMode) {
    await setLocalValue("preferences", normalizedPreferences);
  }

  const projects = normalizeProjects(storedProjects);
  const activeProjectId = typeof storedActiveProjectId === "string" && projects.some((project) => project.id === storedActiveProjectId)
    ? storedActiveProjectId
    : null;

  return {
    chats: sortChats(storedChats ?? []),
    preferences: normalizedPreferences,
    draft: storedDraft ?? "",
    projects,
    activeProjectId
  };
}
