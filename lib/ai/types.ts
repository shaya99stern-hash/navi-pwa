import type { UIMessage } from "ai";

export type SwarmPreset = "navi-fable" | "navi-sol";

export type ModelPreset =
  | "auto"
  | SwarmPreset
  | "gemini-direct"
  | "groq-direct"
  | "huggingface-direct";

export type ResponseStyle = "balanced" | "concise" | "detailed";
export type ThemePreference = "dark" | "light" | "system";
export type DensityPreference = "comfortable" | "compact";
export type MotionPreference = "full" | "reduced";
export type ConnectorAccessMode = "ask" | "auto" | "always";

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

export type NaviProject = {
  id: string;
  name: string;
  instructions: string;
  knowledge: string[];
  createdAt: number;
  updatedAt: number;
  syncState: "local" | "synced" | "attention";
};

export type StoredChat = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  pinned: boolean;
  summary?: string;
  attachments?: AttachmentMeta[];
  projectId?: string;
  connectorAccessMode?: ConnectorAccessMode;
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
  connectorAccessMode: ConnectorAccessMode;
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

export type GeneratedImagePayload = {
  id: string;
  title: string;
  alt: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  prompt: string;
  width?: number;
  height?: number;
};

export type NaviStreamStatus = {
  stage:
    | "gather"
    | "plan"
    | "draft"
    | "synthesize"
    | "verify"
    | "stream"
    | "complete"
    | "interrupted"
    | "error";
  detail: string;
};

/** Honest, server-side diagnostics for composite orchestration. Never expose private reasoning. */
export type NaviSwarmExecution = {
  profile: SwarmPreset;
  configuredRoleCount: number;
  councilCallsPlanned: number;
  councilCallsSucceeded: number;
  providerDiversityAchieved: number;
  providerDiversityRequired: number;
  candidateCallsSucceeded: number;
  verification: "verified" | "verified-fallback" | "candidate-fallback";
  deadlineMs: number;
  elapsedMs: number;
  historyMessagesOmitted: number;
  attachmentPartsOmitted: number;
};
