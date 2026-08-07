import type { UIMessage } from "ai";

export type SwarmPreset = "navi-fable" | "navi-sol";

/**
 * The product mode. One brain — NaviSoul — and two ways to work with it.
 *
 * The user switches mode, never model. Which free provider answers is an
 * implementation detail they neither see nor choose, so it does not belong in
 * a type the interface reads.
 */
export type NaviMode = "chat" | "code";

/** Retained only so preferences stored by v4.2.0 and earlier still migrate. */
export type LegacyModelPreset =
  | "navi-soul" | "navi-chat" | "navi-code" | "auto"
  | "navi-fable" | "navi-sol"
  | "gemini-direct" | "groq-direct" | "huggingface-direct";

/**
 * Internal routing identity. Never surfaced: the diagnostics page may pin one,
 * and the router selects one, but no ordinary screen names it.
 */
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
  mode: NaviMode;
  /** Diagnostics-only route pin. Absent for every ordinary user. */
  routeOverride?: ModelPreset;
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
  /** Connectors the user added themselves from the Connectors screen. */
  customConnectors: CustomConnector[];
  connectorAccessMode: ConnectorAccessMode;
  lastMenuSection: MenuSection;
};

export type CustomConnectorKind = "openai" | "anthropic" | "supabase" | "mcp";

/**
 * A connector typed in on the device rather than configured in the deployment.
 * It lives in preferences — on the device and, signed in, in the user's own
 * row-level-secured cloud memory — and its key is sent per request, never
 * stored server-side.
 */
export type CustomConnector = {
  id: string;
  kind: CustomConnectorKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Default model for AI-API kinds; ignored by the rest. */
  model?: string;
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
  | "mistral"
  /** The one metered provider. Guarded by the spend ceiling in `spend.ts`. */
  | "deepseek";

export type ProviderRoute = {
  provider: ProviderName;
  model: string;
  label: string;
  capability: "fast" | "balanced" | "reasoning" | "multimodal" | "tools" | "long-context" | "coding";
};

/**
 * Whether a route accepts a `tools` parameter.
 *
 * Tool support is a property of the *model*, not the provider. Groq, for one,
 * serves both models that take a tools array and agentic systems that reject
 * one outright — sending tools to the latter fails the whole request. Routes
 * therefore declare their own answer rather than inheriting the provider's.
 */
export type ToolCallingSupport = "custom" | "none";

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
