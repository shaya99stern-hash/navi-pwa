import type { UIMessage } from "ai";
import type { ModelPreset, NaviPreferences, ResponseStyle, StoredChat } from "./ai/types";

export const MODEL_PRESETS: Array<{ id: ModelPreset; label: string; detail: string; composite: boolean }> = [
  { id: "auto", label: "Navi Auto", detail: "Chooses the most reliable path for the request", composite: false },
  { id: "fable-5", label: "Fable 5 — Navi MoA", detail: "Navi composite preset · narrative and reasoning", composite: true },
  { id: "opus-4-8", label: "Opus 4.8 — Navi MoA", detail: "Navi composite preset · strongest verification", composite: true },
  { id: "gemini-flash", label: "Gemini Flash Free", detail: "Direct Gemini Flash route", composite: false },
  { id: "groq-fast", label: "Groq Fast", detail: "Direct low-latency Groq route", composite: false },
  { id: "openrouter-free", label: "OpenRouter Free", detail: "Direct OpenRouter free-model router", composite: false }
];

export const RESPONSE_STYLES: Array<{ id: ResponseStyle; label: string }> = [
  { id: "balanced", label: "Balanced" },
  { id: "concise", label: "Concise" },
  { id: "detailed", label: "Detailed" }
];

export const DEFAULT_PREFERENCES: NaviPreferences = {
  preset: "auto",
  style: "balanced",
  theme: "dark",
  density: "comfortable",
  motion: "full",
  haptics: true,
  saveHistory: true,
  tools: { web: false, code: false, artifacts: true },
  connectedMcpServers: [],
  lastMenuSection: "current"
};

export function createId(prefix = "chat"): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function chatTitle(messages: UIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = first ? messageText(first) : "";
  return !text ? "New chat" : text.length > 52 ? `${text.slice(0, 52)}…` : text;
}

export function chatPreview(messages: UIMessage[]): string {
  const latest = [...messages].reverse().find((message) => messageText(message));
  const text = latest ? messageText(latest).replace(/\s+/g, " ") : "No messages yet";
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

export function sortChats(chats: StoredChat[]): StoredChat[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}
