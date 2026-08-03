import type { UIMessage } from "ai";

export type SwarmPreset = "navi-fable" | "navi-sol";

export type ModelPreset =
  | "navi-soul"
  | "navi-code"
  | "auto"
  | SwarmPreset
  | "gemini-direct"
  | "groq-direct"
  | "huggingface-direct";

export type ResponseStyle = "balanced" | "concise" | "detailed";
/**
 * How much work a response should do. Three levels, the grammar people
 * actually reach for; the middle is the default. Each level is a different
 * instruction *and* a different route, not a relabel of the same request.
 */
export type EffortLevel = "low" | "medium" | "high";
export type ChatFontPreference = "serif" | "sans";
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
  /** Thumbs feedback keyed by assistant message id. Local only. */
  ratings?: Record<string, "up" | "down">;
  messages: UIMessage[];
};

/** User-level identity and standing instructions, injected into every chat. */
export type NaviProfile = {
  fullName: string;
  displayName: string;
  work: string;
  instructions: string;
};

export type NaviPreferences = {
  preset: ModelPreset;
  style: ResponseStyle;
  effort: EffortLevel;
  theme: ThemePreference;
  chatFont: ChatFontPreference;
  density: DensityPreference;
  motion: MotionPreference;
  haptics: boolean;
  saveHistory: boolean;
  /** Let a new chat draw on passages from earlier ones, computed on-device. */
  memory: boolean;
  /** SKILL.md playbooks pasted in by the user, stored on this device. */
  customPlaybooks: Array<{ id: string; name: string; description: string; instructions: string }>;
  notifyOnComplete: boolean;
  voiceLanguage: string;
  profile: NaviProfile;
  tools: ToolPolicy;
  connectedMcpServers: string[];
  connectorAccessMode: ConnectorAccessMode;
  lastMenuSection: MenuSection;
};

export type MenuSection =
  | "general"
  | "account"
  | "privacy"
  | "capabilities"
  | "connectors"
  | "skills"
  | "playbooks";

export type ProviderName =
  | "gemini"
  | "groq"
  | "huggingface"
  | "cerebras"
  | "openrouter"
  | "mistral";

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
  /** Navi-branded engine name shown on the card, never the raw model id. */
  engine?: string;
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
