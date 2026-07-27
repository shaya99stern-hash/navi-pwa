import type { UIMessage } from "ai";

export type ModelPreset =
  | "auto"
  | "navi-5"
  | "navi-sol-5-6"
  | "gemini-direct"
  | "groq-direct"
  | "huggingface-direct";

export type ResponseStyle = "balanced" | "concise" | "detailed";
export type ThemePreference = "dark" | "light" | "system";
export type DensityPreference = "comfortable" | "compact";
export type MotionPreference = "full" | "reduced";

export type ToolPolicy = {
  web: boolean;
  code: boolean;
  artifacts: boolean;
};

export type AttachmentMeta = {
  name: string;
  type: string;
  size: number;
};

export type StoredChat = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  pinned: boolean;
  summary?: string;
  attachments?: AttachmentMeta[];
  messages: UIMessage[];
};

export type NaviPreferences = {
  preset: ModelPreset;
  style: ResponseStyle;
  theme: ThemePreference;
  density: DensityPreference;
  motion: MotionPreference;
  haptics: boolean;
  saveHistory: boolean;
  tools: ToolPolicy;
  connectedMcpServers: string[];
  lastMenuSection: MenuSection;
};

export type MenuSection =
  | "current"
  | "models"
  | "tools"
  | "connections"
  | "personalization"
  | "system";

export type ProviderName = "gemini" | "groq" | "huggingface";

export type ProviderRoute = {
  provider: ProviderName;
  model: string;
  label: string;
  capability: "fast" | "balanced" | "reasoning" | "multimodal" | "tools" | "long-context" | "coding";
};

export type ArtifactKind = "html" | "svg";

export type ArtifactPayload = {
  id: string;
  title: string;
  kind: ArtifactKind;
  html?: string;
  svg?: string;
  height?: number;
};

export type NaviStreamStatus = {
  stage: "gather" | "plan" | "draft" | "synthesize" | "verify" | "stream" | "complete";
  detail: string;
};
