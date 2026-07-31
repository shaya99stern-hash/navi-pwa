"use client";

import { Check, ChevronRight, Download, Ellipsis, FilePlus2, FolderKanban, Link2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MenuSection, ModelPreset, NaviPreferences, ResponseStyle } from "@/lib/ai/types";
import type { PublicMcpServer } from "@/lib/mcp";
import { MODEL_PRESETS, RESPONSE_STYLES } from "@/lib/chat";
import {
  PWA_UPDATE_STATUS_EVENT,
  requestPwaUpdate,
  type PwaUpdateStatus
} from "@/lib/pwa-update";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type ProviderAvailability = { gemini: boolean; groq: boolean; huggingface: boolean };

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  pendingFiles: File[];
  onToggle: () => void;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
  onOpenHistory: () => void;
  onOpenProjects: () => void;
  onOpenConnectors: () => void;
  onFiles: (files: FileList | null) => void;
  onClearFiles: () => void;
  onClearThread: () => void;
  onClearData: () => void;
  onExport: () => void;
};

const EMPTY_PROVIDERS: ProviderAvailability = { gemini: false, groq: false, huggingface: false };
const DEFAULT_UPDATE_STATUS: PwaUpdateStatus = {
  phase: "idle",
  message: "Checks for the latest version, refreshes the app shell, and reopens Navi. Chats stay saved."
};
const VOICE_LANGUAGES: Array<[string, string]> = [
  ["auto", "Match device"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["he-IL", "Hebrew"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["pt-BR", "Portuguese (BR)"],
  ["ja-JP", "Japanese"]
];

const SECTIONS: Array<{ id: MenuSection; label: string }> = [
  { id: "current", label: "Current mode" },
  { id: "models", label: "Models" },
  { id: "tools", label: "Tools & uploads" },
  { id: "connections", label: "Connections" },
  { id: "personalization", label: "Personalization" },
  { id: "system", label: "System" }
];

function Toggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-[100ms] ${value ? "bg-accent" : "bg-elev-3"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-[140ms] ${value ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function SettingRow({ title, detail, action }: { title: string; detail?: string; action: ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]/[22px] font-medium text-primary">{title}</span>
        {detail ? <span className="block text-[12px]/4 font-medium text-tertiary">{detail}</span> : null}
      </span>
      {action}
    </div>
  );
}

export function UnifiedTopMenu({
  open,
  preferences,
  pendingFiles,
  onToggle,
  onClose,
  onPreferences,
  onOpenHistory,
  onOpenProjects,
  onOpenConnectors,
  onFiles,
  onClearFiles,
  onClearThread,
  onClearData,
  onExport
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<MenuSection>(preferences.lastMenuSection);
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderAvailability>(EMPTY_PROVIDERS);
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const sheet = useSheetDrag({ onDismiss: onClose, haptics: preferences.haptics });
  const [voiceLanguage, setVoiceLanguage] = useState("auto");

  useEffect(() => {
    setVoiceLanguage(localStorage.getItem("navi.voice.language.v1") || "auto");
  }, []);

  function updateVoiceLanguage(value: string) {
    setVoiceLanguage(value);
    if (value === "auto") localStorage.removeItem("navi.voice.language.v1");
    else localStorage.setItem("navi.voice.language.v1", value);
    haptic("selection", preferences.haptics);
  }

  useEffect(() => {
    const receiveUpdateStatus = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receiveUpdateStatus);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receiveUpdateStatus);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSection(preferences.lastMenuSection);
    void Promise.all([
      fetch("/api/mcp/connect", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { servers?: PublicMcpServer[] }) => setServers(Array.isArray(data.servers) ? data.servers : []))
        .catch(() => setServers([])),
      fetch("/api/models", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { providers?: ProviderAvailability }) => setProviders(data.providers ?? EMPTY_PROVIDERS))
        .catch(() => setProviders(EMPTY_PROVIDERS))
    ]);
  }, [open, preferences.lastMenuSection]);

  function update(patch: Partial<NaviPreferences>) {
    onPreferences({ ...preferences, ...patch });
  }

  function selectSection(next: MenuSection) {
    setSection(next);
    update({ lastMenuSection: next });
    haptic("selection", preferences.haptics);
  }

  function selectPreset(preset: ModelPreset) {
    update({ preset });
    haptic("selection", preferences.haptics);
  }

  function selectStyle(style: ResponseStyle) {
    update({ style });
    haptic("selection", preferences.haptics);
  }

  function refreshAndUpdate() {
    setUpdateStatus({ phase: "checking", message: "Checking for the newest Navi version…" });
    haptic("impact-light", preferences.haptics);
    requestPwaUpdate();
  }

  async function toggleServer(server: PublicMcpServer) {
    const connected = preferences.connectedMcpServers.includes(server.id);
    if (connected) {
      update({ connectedMcpServers: preferences.connectedMcpServers.filter((id) => id !== server.id) });
      haptic("selection", preferences.haptics);
      return;
    }
    setConnecting(server.id);
    setConnectionError(null);
    try {
      const response = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: server.id })
      });
      const result = (await response.json()) as { connected?: boolean; error?: string };
      if (!response.ok || !result.connected) throw new Error(result.error || "Connection failed.");
      update({ connectedMcpServers: [...preferences.connectedMcpServers, server.id] });
      haptic("success", preferences.haptics);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Connection failed.");
      haptic("error", preferences.haptics);
    } finally {
      setConnecting(null);
    }
  }

  const activePreset = MODEL_PRESETS.find((item) => item.id === preferences.preset) ?? MODEL_PRESETS[0];
  const providerSummary = [
    providers.huggingface && "Hugging Face",
    providers.gemini && "Gemini",
    providers.groq && "Groq"
  ].filter(Boolean).join(" · ") || "No provider keys detected";
  const updateBusy = updateStatus.phase === "checking" || updateStatus.phase === "downloading" || updateStatus.phase === "restarting";

  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label="Chat options" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-elev-2">
        <Ellipsis size={21} strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90]">
          <button type="button" aria-label="Close options" onClick={onClose} className="absolute inset-0 bg-overlay" />
          <section {...sheet.sheetProps} className="navi-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-[720px] flex-col overflow-hidden md:max-w-[480px]">
            <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>
            <header className="flex h-12 shrink-0 items-center justify-between px-4">
              <div className="text-[17px]/6 font-semibold tracking-[-0.01em] text-primary">Options</div>
              <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-elev-2 text-secondary active:bg-elev-3" aria-label="Close menu"><X size={18} /></button>
            </header>

            <nav className="scroll-area flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-3 py-2" aria-label="NaviOS Hub menu sections">
              {SECTIONS.map((item) => (
                <button key={item.id} type="button" onClick={() => selectSection(item.id)} className={`min-h-9 shrink-0 rounded-full px-3 text-[12px]/4 font-semibold ${section === item.id ? "bg-[var(--selection-bg)] text-primary" : "text-tertiary active:bg-elev-3"}`}>
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="scroll-area min-h-0 flex-1 overflow-y-auto pb-[calc(16px+var(--safe-bottom))]">
              {section === "current" ? (
                <div className="p-4">
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-elev-2 p-4">
                    <div className="text-[13px]/[18px] font-semibold text-tertiary">Current mode</div>
                    <div className="mt-1 text-[17px]/6 font-semibold text-primary">{activePreset.label}</div>
                    <div className="mt-1 text-[12px]/4 font-medium text-secondary">{activePreset.detail}</div>
                    {activePreset.composite ? <div className="mt-3 text-[12px]/4 font-medium text-tertiary">Specialist deliberation is private. Only Navi’s final response appears in the conversation.</div> : null}
                    <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[12px]/4 font-medium text-tertiary">Available providers: {providerSummary}</div>
                    <div className="mt-1 text-[12px]/4 font-medium text-tertiary">Connector access: {preferences.connectorAccessMode}</div>
                  </div>
                  <button type="button" onClick={() => selectSection("models")} className="mt-3 flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2">Change Navi mode<ChevronRight size={18} /></button>
                  <button type="button" onClick={() => { onOpenProjects(); onClose(); }} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2"><FolderKanban size={18} className="text-accent" /><span className="min-w-0 flex-1">Projects</span><ChevronRight size={18} /></button>
                  <button type="button" onClick={() => { onOpenConnectors(); onClose(); }} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2"><Link2 size={18} className="text-accent" /><span className="min-w-0 flex-1">Connectors</span><ChevronRight size={18} /></button>
                  <button type="button" onClick={() => { onOpenHistory(); onClose(); }} className="flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2">Open conversation history<ChevronRight size={18} /></button>
                </div>
              ) : null}

              {section === "models" ? (
                <div className="p-2">
                  {MODEL_PRESETS.map((item) => (
                    <button key={item.id} type="button" onClick={() => selectPreset(item.id)} className={`flex min-h-[62px] w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-3 ${preferences.preset === item.id ? "bg-[var(--selection-bg)]" : ""}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px]/[22px] font-medium text-primary">{item.label}</span>
                        <span className="block text-[12px]/4 font-medium text-tertiary">{item.detail}</span>
                      </span>
                      {preferences.preset === item.id ? <Check size={18} className="text-accent" /> : null}
                    </button>
                  ))}
                  <div className="mx-2 my-3 border-t border-[var(--border-subtle)]" />
                  <div className="px-3 pb-2 text-[13px]/[18px] font-semibold text-secondary">Response style</div>
                  <div className="grid grid-cols-3 gap-1 rounded-2xl bg-elev-2 p-1.5">
                    {RESPONSE_STYLES.map((item) => (
                      <button key={item.id} type="button" onClick={() => selectStyle(item.id)} className={`min-h-10 rounded-xl px-2 text-[12px]/4 font-semibold ${preferences.style === item.id ? "bg-elev-3 text-primary" : "text-tertiary"}`}>{item.label}</button>
                    ))}
                  </div>
                </div>
              ) : null}

              {section === "tools" ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  <SettingRow title="Web capability" detail="Used only when the active provider actually supports it" action={<Toggle label="Web capability" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />} />
                  <SettingRow title="Code execution flag" detail="Allows a capable route to use code tools" action={<Toggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />} />
                  <SettingRow title="Artifact mode" detail="Permit secure interactive or SVG outputs" action={<Toggle label="Artifact mode" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />} />
                  <div className="p-4">
                    <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json,application/pdf" onChange={(event) => { onFiles(event.target.files); event.currentTarget.value = ""; }} className="hidden" />
                    <button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-elev-2 px-4 text-[15px]/[22px] font-medium text-primary active:bg-elev-3"><FilePlus2 size={18} />Add files or images</button>
                    {pendingFiles.length ? (
                      <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px]/[18px] font-semibold text-primary">{pendingFiles.length} attachment{pendingFiles.length === 1 ? "" : "s"} ready</span>
                          <button type="button" onClick={onClearFiles} className="min-h-9 rounded-xl px-2 text-[12px]/4 font-semibold text-danger active:bg-elev-3">Clear</button>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[12px]/4 font-medium text-tertiary">{pendingFiles.map((file) => file.name).join(" · ")}</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {section === "connections" ? (
                <div className="p-2">
                  <button type="button" onClick={() => { onOpenConnectors(); onClose(); }} className="mb-2 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-[var(--selection-bg)] px-3 text-left text-[14px]/5 font-semibold text-primary active:bg-elev-3"><Link2 size={18} className="text-accent" /><span className="min-w-0 flex-1">Open connector manager</span><ChevronRight size={18} /></button>
                  {servers.length ? servers.map((server) => {
                    const connected = preferences.connectedMcpServers.includes(server.id);
                    return (
                      <div key={server.id} className="flex min-h-[66px] items-center gap-3 rounded-2xl px-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px]/[22px] font-medium text-primary">{server.name}</span>
                          <span className="block truncate text-[12px]/4 font-medium text-tertiary">Remote HTTPS MCP · {server.readOnly ? "read-only" : "writes require confirmation"}</span>
                        </span>
                        {connecting === server.id ? <LoaderCircle size={18} className="animate-spin text-accent" /> : <Toggle label={`Connect ${server.name}`} value={connected} onChange={() => void toggleServer(server)} />}
                      </div>
                    );
                  }) : <div className="px-5 py-10 text-center text-[13px]/[18px] font-medium text-tertiary">No remote MCP servers are configured in Vercel.</div>}
                  {connectionError ? <div className="mx-3 mt-2 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[12px]/4 font-medium text-danger">{connectionError}</div> : null}
                </div>
              ) : null}

              {section === "personalization" ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  <div className="p-4">
                    <div className="mb-2 text-[13px]/[18px] font-semibold text-secondary">Theme</div>
                    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-elev-2 p-1.5">
                      {(["dark", "light", "system"] as const).map((theme) => <button key={theme} type="button" onClick={() => update({ theme })} className={`min-h-10 rounded-xl capitalize text-[12px]/4 font-semibold ${preferences.theme === theme ? "bg-elev-3 text-primary" : "text-tertiary"}`}>{theme}</button>)}
                    </div>
                  </div>
                  <SettingRow title="Compact density" detail="Reduce vertical spacing without shrinking touch targets" action={<Toggle label="Compact density" value={preferences.density === "compact"} onChange={() => update({ density: preferences.density === "compact" ? "comfortable" : "compact" })} />} />
                  <SettingRow title="Reduced motion" detail="Honor system preference and minimize movement" action={<Toggle label="Reduced motion" value={preferences.motion === "reduced"} onChange={() => update({ motion: preferences.motion === "reduced" ? "full" : "reduced" })} />} />
                  <SettingRow title="Semantic haptics" detail="Android vibration fallback; visual feedback on iOS" action={<Toggle label="Semantic haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />} />
                  <SettingRow
                    title="Voice language"
                    detail="Used for dictation and spoken replies"
                    action={(
                      <select
                        value={voiceLanguage}
                        onChange={(event) => updateVoiceLanguage(event.target.value)}
                        aria-label="Voice language"
                        className="min-h-10 rounded-xl border border-[var(--border-subtle)] bg-elev-2 px-2 text-[13px]/5 font-medium text-primary"
                      >
                        {VOICE_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    )}
                  />
                </div>
              ) : null}

              {section === "system" ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  <button type="button" onClick={refreshAndUpdate} disabled={updateBusy} className="flex min-h-[70px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-elev-2 disabled:opacity-70">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]/[22px] font-medium text-primary">Refresh & Update NaviOS Hub</span>
                      <span className={`block text-[12px]/4 font-medium ${updateStatus.phase === "error" ? "text-danger" : "text-tertiary"}`}>{updateStatus.message}</span>
                    </span>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elev-2 text-secondary">
                      <RefreshCw size={18} className={updateBusy ? "animate-spin" : ""} />
                    </span>
                  </button>
                  <SettingRow title="Local history" detail="Threads, projects, and drafts stay in IndexedDB on this device" action={<Toggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />} />
                  <button type="button" onClick={() => { haptic("selection", preferences.haptics); onExport(); }} className="flex min-h-[58px] w-full items-center gap-3 px-4 text-left active:bg-elev-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]/[22px] font-medium text-primary">Export your data</span>
                      <span className="block text-[12px]/4 font-medium text-tertiary">Download chats, projects, and preferences as JSON</span>
                    </span>
                    <Download size={18} className="shrink-0 text-secondary" />
                  </button>
                  <button type="button" onClick={() => { onOpenHistory(); onClose(); }} className="flex min-h-[58px] w-full items-center justify-between px-4 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2">Conversation history<ChevronRight size={18} /></button>
                  <button type="button" onClick={() => { onClearThread(); onClose(); }} className="min-h-[58px] w-full px-4 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-2">Clear current thread</button>
                  <button type="button" onClick={() => { if (window.confirm("Clear all Navi history, projects, and settings from this device?")) { onClearData(); onClose(); } }} className="min-h-[58px] w-full px-4 text-left text-[15px]/[22px] font-medium text-danger active:bg-elev-2">Clear all local data</button>
                  <div className="px-4 py-5 text-[12px]/4 font-medium text-tertiary">NaviOS Hub 4.1 · Projects · Connector approvals · Automatic app updates.</div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
