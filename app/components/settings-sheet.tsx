"use client";

import {
  ChevronLeft,
  ChevronRight,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences } from "@/lib/ai/types";
import { categories, isImplemented, type Skill } from "@/lib/skills";
import { BUILT_IN_PLAYBOOKS, parseSkillMarkdown } from "@/lib/playbooks";
import { MODEL_PRESETS } from "@/lib/chat";
import {
  PWA_UPDATE_STATUS_EVENT,
  requestPwaUpdate,
  type PwaUpdateStatus
} from "@/lib/pwa-update";
import type { StorageDurability } from "@/lib/storage/indexeddb";
import { haptic } from "@/lib/ui/haptics";
import { versionLabel } from "@/lib/version";

/**
 * Settings, structured the way a native settings surface is: a root list in
 * two groups (Settings, Customize), each page a drill-down with a back
 * button. On phones this reads as the standard iOS settings pattern; the
 * chip-tab sheet it replaces read as neither iOS nor desktop.
 *
 * Control grammar, applied everywhere:
 *  - rows are label-left / control-right with hairline dividers, no cards
 *  - segmented controls hug their content and sit right-aligned
 *  - dropdowns are bare value + chevron (the native select is an invisible
 *    overlay, so iOS still presents its own picker wheel)
 *  - only a standing-instructions textarea may be full width
 */

type Props = {
  open: boolean;
  initialSection?: MenuSection;
  durability: StorageDurability;
  preferences: NaviPreferences;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
  onOpenConnectors: () => void;
  onClearData: () => void;
  onExport: () => void;
};

type PageId = "root" | MenuSection;

const DEFAULT_UPDATE_STATUS: PwaUpdateStatus = {
  phase: "idle",
  message: "Checks for the latest version and applies it. Chats stay saved."
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

const WORK_OPTIONS: Array<[string, string]> = [
  ["", "Not set"],
  ["Engineering", "Engineering"],
  ["Design", "Design"],
  ["Writing", "Writing"],
  ["Research", "Research"],
  ["Education", "Education"],
  ["Business", "Business"],
  ["Student", "Student"],
  ["Other", "Other"]
];

const PAGE_TITLES: Record<Exclude<PageId, "root">, string> = {
  general: "General",
  account: "Account",
  privacy: "Privacy",
  capabilities: "Capabilities",
  connectors: "Connectors",
  skills: "Skills",
  playbooks: "Playbooks"
};

const DURABILITY_DETAIL: Record<StorageDurability, string> = {
  persisted: "Stored on this device and protected from automatic cleanup",
  "best-effort": "Stored on this device · the browser may clear it if space runs low",
  unavailable: "Stored on this device · export regularly, this browser cannot protect it"
};

/** Section header: bold, sentence case, generous top margin, no dividers of its own. */
function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-10 px-4 text-[0.9375rem]/5 font-semibold text-primary first:mt-4">{children}</h3>;
}

/** Label-left / control-right row. Divider comes from the parent group. */
function Row({ label, description, control, fullWidthControl }: {
  label: string;
  description?: ReactNode;
  control?: ReactNode;
  fullWidthControl?: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[0.9375rem]/[1.375rem] font-medium text-primary">{label}</span>
        {control}
      </div>
      {description ? <p className="mt-0.5 max-w-[92%] text-[0.8125rem]/[1.125rem] text-tertiary">{description}</p> : null}
      {fullWidthControl ? <div className="mt-2.5">{fullWidthControl}</div> : null}
    </div>
  );
}

/** Rows in a section are separated by hairlines; never one after the last. */
function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--border-subtle)]">{children}</div>;
}

/** C6 — toggle. The accent stays reserved for marks; the ON track is light. */
export function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-[120ms] ${value ? "bg-[var(--text-primary)]" : "bg-elev-3"}`}
    >
      <span className={`absolute top-[3px] h-5 w-5 rounded-full shadow-sm transition-transform duration-[140ms] ${value ? "translate-x-[21px] bg-[var(--bg-app)]" : "translate-x-[3px] bg-white"}`} />
    </button>
  );
}

/** C1 — icon segmented control. Hugs content, right-aligned by the row. */
function IconSegmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ id: T; icon: ReactNode; name: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-full bg-elev-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.name}
          onClick={() => onChange(option.id)}
          className={`flex h-[30px] w-[34px] items-center justify-center rounded-full transition-colors duration-[100ms] ${value === option.id ? "bg-elev-3 text-primary" : "text-tertiary"}`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

/** C2 — text segmented control. Same shell as C1, words instead of icons. */
function TextSegmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ id: T; name: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-full bg-elev-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-[30px] rounded-full px-3 text-[0.8125rem]/5 font-medium transition-colors duration-[100ms] ${value === option.id ? "bg-elev-3 text-primary" : "text-tertiary"}`}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}

/**
 * C3 — bare dropdown: value text + chevron, no box. The real select sits
 * invisibly on top so the device presents its own picker, which is the one
 * part of a native select worth keeping.
 */
function BareSelect({ value, options, onChange, label }: {
  value: string;
  options: Array<[string, string]>;
  onChange: (next: string) => void;
  label: string;
}) {
  const current = options.find(([id]) => id === value)?.[1] ?? options[0]?.[1] ?? "";
  return (
    <span className="relative flex shrink-0 items-center gap-1.5 text-[0.9375rem]/5 text-primary">
      {current}
      <ChevronRight size={14} className="rotate-90 text-tertiary" />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </span>
  );
}

/** C4 — right-aligned text input. */
function TextField({ value, onChange, label, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-[46%] min-w-0 shrink-0 rounded-[10px] bg-elev-2 px-3 text-right text-[0.9375rem]/5 text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
    />
  );
}

/** C8 — small inline pill button. */
function InlineButton({ children, onClick, destructive }: { children: ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full bg-elev-2 px-4 text-[0.8125rem]/5 font-medium active:bg-elev-3 ${destructive ? "text-danger" : "text-primary"}`}
    >
      {children}
    </button>
  );
}

/** Read-only connection state: connected surfaces are green, absent ones gray. */
function StatusPill({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.75rem]/4 font-medium ${on ? "bg-[var(--selection-bg)] text-accent" : "bg-elev-2 text-tertiary"}`}>
      {on ? "Connected" : "Not connected"}
    </span>
  );
}

function RootRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[52px] w-full items-center justify-between px-4 text-left active:bg-elev-2">
      <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary">{label}</span>
      <ChevronRight size={18} className="text-tertiary" />
    </button>
  );
}

export function SettingsSheet({
  open,
  initialSection,
  durability,
  preferences,
  onClose,
  onPreferences,
  onOpenConnectors,
  onClearData,
  onExport
}: Props) {
  const [page, setPage] = useState<PageId>("root");
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [account, setAccount] = useState<{ email: string; canSignOut: boolean }>({ email: "", canSignOut: false });
  const [devTools, setDevTools] = useState<{ github: boolean; vercel: boolean }>({ github: false, vercel: false });
  const [playbookDraft, setPlaybookDraft] = useState("");
  const [playbookNotice, setPlaybookNotice] = useState<string | null>(null);
  const skillGroups = useMemo(
    () => categories()
      .map((group) => ({ ...group, skills: group.skills.filter((skill: Skill) => isImplemented(skill.id)) }))
      .filter((group) => group.skills.length),
    []
  );

  useEffect(() => {
    if (!open) return;
    setPage(initialSection ?? "root");
    fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { devTools?: { github?: boolean; vercel?: boolean } }) => setDevTools({
        github: data.devTools?.github === true,
        vercel: data.devTools?.vercel === true
      }))
      .catch(() => setDevTools({ github: false, vercel: false }));
  }, [initialSection, open]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receive);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receive);
  }, []);

  /* Clerk exposes the signed-in user on window when it is configured; when it
     is not, the Account page simply describes the local workspace. */
  useEffect(() => {
    if (!open) return;
    const clerk = (window as unknown as { Clerk?: { user?: { primaryEmailAddress?: { emailAddress?: string } }; signOut?: () => Promise<void> } }).Clerk;
    setAccount({
      email: clerk?.user?.primaryEmailAddress?.emailAddress ?? "",
      canSignOut: typeof clerk?.signOut === "function"
    });
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<NaviPreferences>) => {
    onPreferences({ ...preferences, ...patch });
    haptic("selection", preferences.haptics);
  };
  const updateProfile = (patch: Partial<NaviPreferences["profile"]>) => {
    onPreferences({ ...preferences, profile: { ...preferences.profile, ...patch } });
  };
  const openPage = (next: MenuSection) => {
    if (next === "connectors") {
      onClose();
      onOpenConnectors();
      return;
    }
    setPage(next);
    update({ lastMenuSection: next });
  };
  const updateBusy = updateStatus.phase === "checking" || updateStatus.phase === "downloading" || updateStatus.phase === "restarting";

  async function signOut() {
    const clerk = (window as unknown as { Clerk?: { signOut?: () => Promise<void> } }).Clerk;
    try {
      await clerk?.signOut?.();
    } finally {
      window.location.href = "/sign-in";
    }
  }

  async function enableNotifications() {
    if (preferences.notifyOnComplete) {
      update({ notifyOnComplete: false });
      return;
    }
    if (!("Notification" in window)) return;
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") update({ notifyOnComplete: true });
  }

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-app" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 pt-[var(--safe-top)]">
        {page === "root" ? (
          <div className="flex h-11 w-11 items-center justify-center" aria-hidden="true" />
        ) : (
          <button type="button" onClick={() => setPage("root")} aria-label="Back to Settings" className="flex h-11 w-11 items-center justify-center rounded-full text-primary active:bg-elev-2">
            <ChevronLeft size={22} strokeWidth={1.8} />
          </button>
        )}
        <div className="flex-1 text-center text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary">
          {page === "root" ? "Settings" : PAGE_TITLES[page]}
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-11 w-11 items-center justify-center rounded-full text-primary active:bg-elev-2">
          <X size={20} strokeWidth={1.8} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))]">
        {page === "root" ? (
          <>
            <p className="mt-4 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Settings</p>
            <Group>
              <RootRow label="General" onOpen={() => openPage("general")} />
              <RootRow label="Account" onOpen={() => openPage("account")} />
              <RootRow label="Privacy" onOpen={() => openPage("privacy")} />
              <RootRow label="Capabilities" onOpen={() => openPage("capabilities")} />
            </Group>
            <p className="mt-8 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Customize</p>
            <Group>
              <RootRow label="Skills" onOpen={() => openPage("skills")} />
              <RootRow label="Playbooks" onOpen={() => openPage("playbooks")} />
              <RootRow label="Connectors" onOpen={() => openPage("connectors")} />
            </Group>
            <p className="px-4 py-6 text-[0.75rem]/4 text-tertiary">NaviOS Hub · {versionLabel()}</p>
          </>
        ) : null}

        {page === "general" ? (
          <>
            <SectionHeader>Profile</SectionHeader>
            <Group>
              <Row label="Full name" control={<TextField label="Full name" value={preferences.profile.fullName} onChange={(fullName) => updateProfile({ fullName })} />} />
              <Row label="What should Navi call you?" control={<TextField label="Display name" value={preferences.profile.displayName} onChange={(displayName) => updateProfile({ displayName })} />} />
              <Row label="What best describes your work?" control={<BareSelect label="Work" value={preferences.profile.work} options={WORK_OPTIONS} onChange={(work) => updateProfile({ work })} />} />
              <Row
                label="Instructions for Navi"
                description="Navi keeps these in mind across every chat on this device."
                fullWidthControl={
                  <textarea
                    aria-label="Instructions for Navi"
                    value={preferences.profile.instructions}
                    onChange={(event) => updateProfile({ instructions: event.target.value.slice(0, 4_000) })}
                    placeholder="e.g. keep explanations brief and to the point"
                    rows={4}
                    className="min-h-[112px] w-full resize-y rounded-[12px] bg-elev-2 px-3.5 py-3 text-[0.9375rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
                  />
                }
              />
            </Group>

            <SectionHeader>Preferences</SectionHeader>
            <Group>
              <Row
                label="Appearance"
                control={
                  <IconSegmented
                    label="Appearance"
                    value={preferences.theme}
                    options={[
                      { id: "system", icon: <Monitor size={16} strokeWidth={1.8} />, name: "System" },
                      { id: "light", icon: <Sun size={16} strokeWidth={1.8} />, name: "Light" },
                      { id: "dark", icon: <Moon size={16} strokeWidth={1.8} />, name: "Dark" }
                    ]}
                    onChange={(theme) => update({ theme })}
                  />
                }
              />
              <Row
                label="Chat font"
                control={
                  <BareSelect
                    label="Chat font"
                    value={preferences.chatFont}
                    options={[["serif", "Navi Serif"], ["sans", "System"]]}
                    onChange={(value) => update({ chatFont: value === "sans" ? "sans" : "serif" })}
                  />
                }
              />
              <Row
                label="Motion"
                description="Reduce animation in streaming responses and other interface elements."
                control={
                  <TextSegmented
                    label="Motion"
                    value={preferences.motion}
                    options={[{ id: "full" as const, name: "System" }, { id: "reduced" as const, name: "Reduced" }]}
                    onChange={(motion) => update({ motion })}
                  />
                }
              />
              <Row
                label="Density"
                control={
                  <TextSegmented
                    label="Density"
                    value={preferences.density}
                    options={[{ id: "comfortable" as const, name: "Comfortable" }, { id: "compact" as const, name: "Compact" }]}
                    onChange={(density) => update({ density })}
                  />
                }
              />
              <Row
                label="Haptics"
                description="Subtle touch feedback on selection, success, and errors."
                control={<SettingsToggle label="Haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />}
              />
            </Group>

            <SectionHeader>Voice</SectionHeader>
            <Group>
              <Row
                label="Language"
                control={
                  <BareSelect
                    label="Voice language"
                    value={preferences.voiceLanguage}
                    options={VOICE_LANGUAGES}
                    onChange={(voiceLanguage) => {
                      update({ voiceLanguage });
                      // Voice mode still reads the legacy key.
                      try {
                        if (voiceLanguage === "auto") localStorage.removeItem("navi.voice.language.v1");
                        else localStorage.setItem("navi.voice.language.v1", voiceLanguage);
                      } catch { /* private browsing */ }
                    }}
                  />
                }
              />
            </Group>

            <SectionHeader>Notifications</SectionHeader>
            <Group>
              <Row
                label="Response completions"
                description="Get notified when Navi has finished a response. Useful for long-running tasks."
                control={<SettingsToggle label="Response completions" value={preferences.notifyOnComplete} onChange={() => void enableNotifications()} />}
              />
            </Group>
          </>
        ) : null}

        {page === "account" ? (
          <>
            <SectionHeader>Account</SectionHeader>
            <Group>
              <Row
                label={account.email ? "Signed in" : "Local workspace"}
                description={account.email || "This device only — no account is attached."}
                control={account.canSignOut ? <InlineButton onClick={() => void signOut()}>Log out</InlineButton> : undefined}
              />
            </Group>

            <SectionHeader>App</SectionHeader>
            <Group>
              <button type="button" onClick={() => { haptic("impact-light", preferences.haptics); setUpdateStatus({ phase: "checking", message: "Checking for the newest version…" }); requestPwaUpdate(); }} disabled={updateBusy} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-elev-2 disabled:opacity-70">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem]/[1.375rem] font-medium text-primary">Update NaviOS Hub</span>
                  <span className="block text-[0.8125rem]/[1.125rem] text-secondary">{versionLabel()}</span>
                  <span className={`block text-[0.75rem]/4 ${updateStatus.phase === "error" ? "text-danger" : "text-tertiary"}`}>{updateStatus.message}</span>
                </span>
                <RefreshCw size={18} className={`shrink-0 text-secondary ${updateBusy ? "animate-spin" : ""}`} />
              </button>
            </Group>

            <SectionHeader>Danger zone</SectionHeader>
            <Group>
              <Row
                label="Clear all local data"
                description="Deletes every chat, project, and preference stored on this device."
                control={<InlineButton destructive onClick={() => { if (window.confirm("Clear all Navi history, projects, and settings from this device?")) { onClearData(); onClose(); } }}>Clear</InlineButton>}
              />
            </Group>
          </>
        ) : null}

        {page === "privacy" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              NaviOS Hub is local-first: conversations, projects, and preferences live in this browser&apos;s storage
              and leave the device only as requests to the AI providers you have configured.
            </p>
            <SectionHeader>Preferences</SectionHeader>
            <Group>
              <Row
                label="Local history"
                description={DURABILITY_DETAIL[durability]}
                control={<SettingsToggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />}
              />
              <Row
                label="Memory"
                description="Let a new chat draw on relevant passages from your earlier ones. Matching happens on this device; only the passages Navi actually uses are sent."
                control={<SettingsToggle label="Memory" value={preferences.memory} onChange={() => update({ memory: !preferences.memory })} />}
              />
            </Group>
            <SectionHeader>Your data</SectionHeader>
            <Group>
              <Row
                label="Export data"
                description="Download chats, projects, and preferences as JSON."
                control={<InlineButton onClick={() => { haptic("selection", preferences.haptics); onExport(); }}>Export data</InlineButton>}
              />
            </Group>
          </>
        ) : null}

        {page === "capabilities" ? (
          <>
            <SectionHeader>General</SectionHeader>
            <Group>
              <Row
                label="Web search"
                description="Let Navi search the web and read pages when a request needs live information."
                control={<SettingsToggle label="Web search" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />}
              />
            </Group>
            <SectionHeader>Visuals</SectionHeader>
            <Group>
              <Row
                label="Artifacts"
                description="Generate interactive documents and designs in a dedicated window alongside your conversation."
                control={<SettingsToggle label="Artifacts" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />}
              />
            </Group>
            <SectionHeader>Code execution and file creation</SectionHeader>
            <Group>
              <Row
                label="Code execution and file creation"
                description="Available only when the selected route actually supplies it."
                control={<SettingsToggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />}
              />
            </Group>
            <SectionHeader>Routing</SectionHeader>
            <Group>
              <Row
                label="Engine"
                description="Navi Soul reads each request and picks the engine that leads at that job. Pin a specific route only to diagnose a problem — it disables that routing entirely."
                control={
                  <BareSelect
                    label="Engine"
                    value={preferences.preset}
                    options={[
                      ["navi-soul", "Automatic"],
                      ...MODEL_PRESETS.filter((preset) => preset.overflow).map((preset) => [preset.id, preset.label] as [string, string])
                    ]}
                    onChange={(value) => update({ preset: value as NaviPreferences["preset"] })}
                  />
                }
              />
            </Group>

            <SectionHeader>Developer</SectionHeader>
            <Group>
              <Row
                label="GitHub"
                description={devTools.github
                  ? "Connected. Navi Code can read your repositories, pull requests, and CI logs."
                  : "Not connected. Add a fine-grained personal access token as NAVI_GITHUB_TOKEN in Vercel to let Navi Code read your repositories and CI logs."}
                control={<StatusPill on={devTools.github} />}
              />
              <Row
                label="Vercel"
                description={devTools.vercel
                  ? "Connected. Navi Code can read your deployments and build logs."
                  : "Not connected. Add a Vercel token as NAVI_VERCEL_TOKEN in Vercel to let Navi Code read deployments and build logs."}
                control={<StatusPill on={devTools.vercel} />}
              />
            </Group>

            <SectionHeader>Skills</SectionHeader>
            <Group>
              <RootRow label="Skills have moved to Customize" onOpen={() => openPage("skills")} />
            </Group>
          </>
        ) : null}

        {page === "playbooks" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              Playbooks are methods Navi applies when a request matches one — how to debug, how to review code,
              how to edit a document without disturbing it. They use Anthropic&apos;s SKILL.md format, so any skill
              published for Claude can be pasted in below and works here unchanged.
            </p>

            <SectionHeader>Add a playbook</SectionHeader>
            <Group>
              <Row
                label="Paste a SKILL.md"
                description="Copy the whole file, including the --- block at the top."
                fullWidthControl={
                  <div>
                    <textarea
                      aria-label="Paste a SKILL.md file"
                      value={playbookDraft}
                      onChange={(event) => { setPlaybookDraft(event.target.value); setPlaybookNotice(null); }}
                      placeholder={"---\nname: my-playbook\ndescription: When Navi should use this\n---\n\n# Instructions…"}
                      rows={5}
                      className="min-h-[128px] w-full resize-y rounded-[12px] bg-elev-2 px-3.5 py-3 font-mono text-[0.8125rem]/[1.125rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const result = parseSkillMarkdown(playbookDraft);
                          if ("error" in result) { setPlaybookNotice(result.error); haptic("error", preferences.haptics); return; }
                          const next = preferences.customPlaybooks.filter((entry) => entry.id !== result.playbook.id);
                          update({ customPlaybooks: [...next, result.playbook].slice(0, 40) });
                          setPlaybookDraft("");
                          setPlaybookNotice(`Added “${result.playbook.name}”.`);
                          haptic("success", preferences.haptics);
                        }}
                        disabled={!playbookDraft.trim()}
                        className="h-9 rounded-full bg-accent px-4 text-[0.8125rem]/5 font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed disabled:opacity-50"
                      >
                        Add playbook
                      </button>
                      {playbookNotice ? (
                        <span className={`min-w-0 flex-1 text-[0.75rem]/4 ${playbookNotice.startsWith("Added") ? "text-success" : "text-danger"}`}>{playbookNotice}</span>
                      ) : null}
                    </div>
                  </div>
                }
              />
            </Group>

            {preferences.customPlaybooks.length ? (
              <>
                <SectionHeader>Yours</SectionHeader>
                <Group>
                  {preferences.customPlaybooks.map((entry) => (
                    <Row
                      key={entry.id}
                      label={entry.name}
                      description={entry.description}
                      control={
                        <InlineButton
                          destructive
                          onClick={() => update({ customPlaybooks: preferences.customPlaybooks.filter((item) => item.id !== entry.id) })}
                        >
                          Remove
                        </InlineButton>
                      }
                    />
                  ))}
                </Group>
              </>
            ) : null}

            <SectionHeader>Built in</SectionHeader>
            <Group>
              {BUILT_IN_PLAYBOOKS.map((entry) => (
                <Row key={entry.id} label={entry.name} description={entry.description} />
              ))}
            </Group>
          </>
        ) : null}

        {page === "skills" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              Skills run instantly on this device — type <span className="font-mono text-primary">/</span> in the composer to use one, even offline.
            </p>
            {skillGroups.map((group) => (
              <div key={group.category}>
                <SectionHeader>{group.category}</SectionHeader>
                <Group>
                  {group.skills.map((skill: Skill) => (
                    <div key={skill.id} className="px-4 py-3">
                      <div className="text-[0.9375rem]/[1.375rem] font-medium text-primary">/{skill.triggers.slash}</div>
                      <div className="text-[0.8125rem]/[1.125rem] text-tertiary">{skill.description}</div>
                    </div>
                  ))}
                </Group>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
