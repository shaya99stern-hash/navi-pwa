import type { UIMessage } from "ai";

export type ModelRoute = "auto" | "openrouter-free" | "groq-balanced" | "groq-reasoning" | "groq-fast";
export type ResponseStyle = "balanced" | "concise" | "detailed";
export type StoredChat = { id: string; title: string; updatedAt: number; messages: UIMessage[] };
export type NaviPreferences = { route: ModelRoute; style: ResponseStyle; saveHistory: boolean };

export const ROUTES: Array<{ id: ModelRoute; label: string; detail: string; icon: "sparkles" | "brain" | "gauge" | "zap" | "settings" }> = [
  { id: "auto", label: "Navi Auto", detail: "Routes each request by complexity", icon: "sparkles" },
  { id: "groq-reasoning", label: "Deep reasoning", detail: "Groq GPT-OSS 120B", icon: "brain" },
  { id: "groq-balanced", label: "Balanced", detail: "Groq Llama 3.3 70B", icon: "gauge" },
  { id: "groq-fast", label: "Fast", detail: "Groq Llama 3.1 8B", icon: "zap" },
  { id: "openrouter-free", label: "OpenRouter Free", detail: "Chooses an available free model", icon: "settings" }
];

export const STYLES: Array<{ id: ResponseStyle; label: string }> = [
  { id: "balanced", label: "Balanced" },
  { id: "concise", label: "Concise" },
  { id: "detailed", label: "Detailed" }
];

export function createId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  return !text ? "New chat" : text.length > 46 ? `${text.slice(0, 46)}…` : text;
}
