import type { UIMessage } from "ai";
import type { ModelPreset, NaviPreferences, ResponseStyle, StoredChat } from "./ai/types";

export const MODEL_PRESETS: Array<{ id: ModelPreset; label: string; detail: string; composite: boolean }> = [
  { id: "auto", label: "Navi Auto", detail: "Chooses a direct route, Navi Fable, or Navi Sol", composite: false },
  { id: "navi-fable", label: "Navi Fable", detail: "Up to 8 long-horizon council calls, with 72 role lenses", composite: true },
  { id: "navi-sol", label: "Navi Sol", detail: "Up to 10 parallel council calls, with 96 role lenses", composite: true },
  { id: "huggingface-direct", label: "Hugging Face Direct", detail: "Best currently available Hugging Face route", composite: false },
  { id: "gemini-direct", label: "Gemini Direct", detail: "Direct Gemini multimodal route", composite: false },
  { id: "groq-direct", label: "Groq Direct", detail: "Direct low-latency reasoning route", composite: false }
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
  connectorAccessMode: "ask",
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
