import type { UIMessage } from "ai";
import type { EffortLevel, ModelPreset, NaviPreferences, ResponseStyle, StoredChat } from "./ai/types";

/**
 * Two entries, and only two. Navi Soul is the lead: it reads each request and
 * dispatches to whichever engine leads at that job — an image goes to the
 * image pipeline, a stack trace to the coding routes, a question about today
 * to search. Navi Code exists for when the whole conversation is technical and
 * that should be assumed rather than inferred per message.
 *
 * Everything below is `overflow: true` and no longer appears in the picker at
 * all. Those routes remain selectable from Settings as a diagnostic override,
 * because "which engine answered?" is the first question when something is
 * wrong — but choosing one should never be part of asking a question.
 */
export const MODEL_PRESETS: Array<{ id: ModelPreset; label: string; detail: string; composite: boolean; overflow?: boolean }> = [
  { id: "navi-soul", label: "Navi Soul", detail: "Chooses the right engine for whatever you ask", composite: false },
  { id: "navi-code", label: "Navi Code", detail: "Software, debugging, and technical work", composite: false },
  { id: "navi-fable", label: "Navi Fable", detail: "Long-horizon multi-role project swarm", composite: true, overflow: true },
  { id: "navi-sol", label: "Navi Sol", detail: "Parallel research and verification swarm", composite: true, overflow: true },
  { id: "huggingface-direct", label: "Hugging Face Direct", detail: "Best currently available Hugging Face route", composite: false, overflow: true },
  { id: "gemini-direct", label: "Gemini Direct", detail: "Direct Gemini multimodal route", composite: false, overflow: true },
  { id: "groq-direct", label: "Groq Direct", detail: "Direct low-latency reasoning route", composite: false, overflow: true }
];

export const RESPONSE_STYLES: Array<{ id: ResponseStyle; label: string }> = [
  { id: "balanced", label: "Balanced" },
  { id: "concise", label: "Concise" },
  { id: "detailed", label: "Detailed" }
];

/**
 * Effort is the one lever a person adjusts per task, so it lives in the model
 * picker rather than in Settings. Each level is a real, distinct instruction
 * to the model — not a relabel of the same prompt.
 */
export const EFFORT_LEVELS: Array<{ id: EffortLevel; label: string; detail: string; isDefault?: boolean }> = [
  { id: "low", label: "Low", detail: "Fastest route, direct answers" },
  { id: "medium", label: "Medium", detail: "Balanced speed and depth", isDefault: true },
  { id: "high", label: "High", detail: "Strongest route, checks its own work" }
];

export const EFFORT_EXPLAINER = "Higher effort means more thorough responses, but takes longer.";

/** Old three-way response styles map onto the effort scale. */
export function effortFromLegacyStyle(style: ResponseStyle | undefined): EffortLevel {
  return style === "concise" ? "low" : style === "detailed" ? "high" : "medium";
}

export const DEFAULT_PREFERENCES: NaviPreferences = {
  preset: "navi-soul",
  style: "balanced",
  effort: "medium",
  theme: "dark",
  chatFont: "serif",
  density: "comfortable",
  motion: "full",
  haptics: true,
  saveHistory: true,
  memory: true,
  customPlaybooks: [],
  notifyOnComplete: false,
  voiceLanguage: "auto",
  profile: { fullName: "", displayName: "", work: "", instructions: "" },
  tools: { web: false, code: false, artifacts: true },
  connectedMcpServers: [],
  connectorAccessMode: "ask",
  lastMenuSection: "general"
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

/* "What is the capital of France? Answer in one sentence." should title the
   chat "Capital of France", not echo the whole prompt into the header. */
const TITLE_LEAD_IN = new RegExp(
  "^(?:please\\s+|hey\\s+|hi\\s+|ok\\s+|okay\\s+)*" +
  "(?:can|could|would|will)?\\s*(?:you|u)?\\s*" +
  "(?:what|who|when|where|which|how|why)?\\s*" +
  "(?:is|are|was|were|do|does|did|to)?\\s+" +
  "(?:the|a|an|my|me|some)?\\s+",
  "i"
);

export function chatTitle(messages: UIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const raw = first ? messageText(first) : "";
  if (!raw) return "New chat";
  // First sentence only, without its lead-in or closing punctuation.
  const sentence = (raw.split(/(?<=[.?!])\s+/, 1)[0] ?? raw).replace(/\s+/g, " ").trim();
  const stripped = sentence.replace(TITLE_LEAD_IN, "").replace(/[.?!,;:\s]+$/, "").trim();
  const body = stripped.length >= 3 ? stripped : sentence.replace(/[.?!,;:\s]+$/, "");
  const words = body.split(" ").slice(0, 7).join(" ");
  const title = words.length > 44 ? `${words.slice(0, 44).replace(/\s+\S*$/, "")}…` : words;
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "New chat";
}

export function chatPreview(messages: UIMessage[]): string {
  const latest = [...messages].reverse().find((message) => messageText(message));
  const text = latest ? messageText(latest).replace(/\s+/g, " ") : "No messages yet";
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

export function sortChats(chats: StoredChat[]): StoredChat[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}
