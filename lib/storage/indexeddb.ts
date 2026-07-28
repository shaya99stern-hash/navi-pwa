import type { ConnectorAccessMode, ModelPreset, NaviPreferences, NaviProject, StoredChat } from "../ai/types";
import { DEFAULT_PREFERENCES, sortChats } from "../chat";

const DB_NAME = "navi-local-v3";
const DB_VERSION = 1;
const STORE = "state";

type PreferenceInput = Omit<Partial<NaviPreferences>, "preset"> & { preset?: unknown };

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

function normalizePreset(value: unknown): ModelPreset {
  const map: Record<string, ModelPreset> = {
    auto: "auto",
    "navi-fable": "navi-fable",
    "navi-sol": "navi-sol",
    "navi-5": "navi-fable",
    "navi-sol-5-6": "navi-sol",
    "gemini-direct": "gemini-direct",
    "groq-direct": "groq-direct",
    "huggingface-direct": "huggingface-direct",
    "fable-5": "navi-fable",
    "opus-4-8": "navi-sol",
    "groq-balanced": "navi-fable",
    "groq-reasoning": "navi-sol",
    "groq-fast": "groq-direct",
    "gemini-flash": "gemini-direct",
    "openrouter-free": "huggingface-direct"
  };
  return map[String(value ?? "auto")] ?? "auto";
}

function normalizeConnectorMode(value: unknown): ConnectorAccessMode {
  return value === "auto" || value === "always" ? value : "ask";
}

function mergePreferences(value?: PreferenceInput): NaviPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    preset: normalizePreset(value?.preset),
    tools: { ...DEFAULT_PREFERENCES.tools, ...(value?.tools ?? {}) },
    connectedMcpServers: Array.isArray(value?.connectedMcpServers) ? value.connectedMcpServers : [],
    connectorAccessMode: normalizeConnectorMode(value?.connectorAccessMode)
  };
}

function normalizeProjects(value: unknown): NaviProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const project = item as Partial<NaviProject>;
    if (typeof project.id !== "string" || typeof project.name !== "string") return [];
    const createdAt = typeof project.createdAt === "number" ? project.createdAt : Date.now();
    return [{
      id: project.id,
      name: project.name,
      instructions: typeof project.instructions === "string" ? project.instructions : "",
      knowledge: Array.isArray(project.knowledge) ? project.knowledge.filter((entry): entry is string => typeof entry === "string").slice(0, 100) : [],
      createdAt,
      updatedAt: typeof project.updatedAt === "number" ? project.updatedAt : createdAt,
      syncState: project.syncState === "synced" || project.syncState === "attention" ? project.syncState : "local"
    }];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
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
    return {
      chats: migrated.chats ?? [],
      preferences: mergePreferences(migrated.preferences),
      draft: storedDraft ?? "",
      projects: normalizeProjects(storedProjects ?? migrated.projects),
      activeProjectId: storedActiveProjectId ?? migrated.activeProjectId ?? null
    };
  }

  const normalizedPreferences = mergePreferences(storedPreferences);
  if (storedPreferences?.preset !== normalizedPreferences.preset || storedPreferences?.connectorAccessMode !== normalizedPreferences.connectorAccessMode) {
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
