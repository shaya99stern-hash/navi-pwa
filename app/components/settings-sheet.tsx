"use client";

import {
  Activity,
  Bell,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Key,
  Link2,
  Mic,
  RefreshCw,
  Settings,
  Shield,
  Volume2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences, ThemePreference } from "@/lib/ai/types";
import { DEFAULT_SELF_UPDATE_BRANCH } from "@/lib/ai/self-update-tools";
import { clampVoiceRate, MAX_VOICE_RATE, MIN_VOICE_RATE } from "@/lib/ui/speech";
import { categories, isImplemented, type Skill } from "@/lib/skills";
import { BUILT_IN_PLAYBOOKS, parseSkillMarkdown } from "@/lib/playbooks";
import { DIAGNOSTIC_ROUTES } from "@/lib/chat";
import { PWA_UPDATE_STATUS_EVENT, requestPwaUpdate, type PwaUpdateStatus } from "@/lib/pwa-update";
import type { StorageDurability } from "@/lib/storage/indexeddb";
import { haptic } from "@/lib/ui/haptics";
import { diagnoseMicrophone, type MicCheck } from "@/lib/ui/recorder";
import { versionLabel } from "@/lib/version";

type Props = {
  open: boolean;
  initialSection?: MenuSection;
  durability: StorageDurability;
  preferences: NaviPreferences;
  localChatCount: number;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
  onOpenConnectors: () => void;
  onClearData: () => void;
  onExport: () => void;
};

type PageId = "root" | "diagnostics" | "profile" | "general" | "privacy" | "capabilities" | "voice" | "permissions";

type AccountState = {
  signedIn: boolean;
  ready: boolean;
  name: string;
  email: string;
};

type ClerkGlobal = {
  loaded?: boolean;
  user?: {
    fullName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    primaryEmailAddress?: { emailAddress?: string };
  } | null;
  signOut?: () => Promise<void>;
};

const DIAGNOSTICS_TAPS = 5;
const DIAGNOSTICS_TAP_WINDOW_MS = 3_000;
const CLERK_AVAILABLE = process.env.NEXT_PUBLIC_NAVI_AUTH === "on";

const PAGE_TITLES: Record<Exclude<PageId, "root">, string> = {
  diagnostics: "Diagnostics",
  profile: "Profile",
  general: "General",
  privacy: "Memory & Storage",
  capabilities: "Capabilities",
  voice: "Voice",
  permissions: "Permissions"
};

const DURABILITY_DETAIL: Record<StorageDurability, string> = {
  persisted: "Protected from automatic cleanup on this device.",
  "best-effort": "The browser may clear local history if storage runs low.",
  unavailable: "This browser cannot guarantee local history retention."
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

const DEFAULT_UPDATE_STATUS: PwaUpdateStatus = {
  phase: "idle",
  message: "Checks for the latest version and applies it."
};

function normalizeInitialPage(section?: MenuSection): PageId {
  if (section === "skills" || section === "playbooks") return "capabilities";
  if (section === "general" || section === "privacy" || section === "capabilities") return section;
  return "root";
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="settings-section-title px-4">{children}</h3>;
}

function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`settings-group mx-4 overflow-hidden ${className}`}>{children}</div>;
}

function Divider({ inset = true }: { inset?: boolean }) {
  return <div className={`h-px bg-[var(--border-subtle)] ${inset ? "ml-4" : ""}`} aria-hidden="true" />;
}

function Row({ label, description, control, onClick }: {
  label: string;
  description?: ReactNode;
  control?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="settings-row-label truncate text-primary">{label}</div>
        {description ? <div className="settings-row-description mt-0.5 text-tertiary">{description}</div> : null}
      </div>
      {control ? <div className="ml-3 flex min-w-0 shrink-0 items-center">{control}</div> : null}
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="settings-row flex w-full items-center gap-3 bg-transparent px-4 text-left active:bg-elev-2">
      {content}
    </button>
  ) : (
    <div className="settings-row flex w-full items-center gap-3 bg-transparent px-4">
      {content}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-[15px] tabular-nums text-secondary">{value}</span>;
}

export function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`settings-switch relative h-6 w-10 shrink-0 rounded-full border transition-colors ${value ? "border-accent bg-accent" : "border-[var(--border-strong)] bg-elev-3"}`}
    >
      <span className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${value ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function TextSegmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ id: T; name: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="settings-segmented flex min-w-0 shrink-0 items-center rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 p-[2px]">
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={`h-8 rounded-[7px] px-3 text-[13px] font-medium transition-colors ${active ? "bg-elev-1 text-primary shadow-sm" : "bg-transparent text-tertiary"}`}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}

function BareSelect({ value, options, onChange, label }: {
  value: string;
  options: Array<[string, string]>;
  onChange: (next: string) => void;
  label: string;
}) {
  const current = options.find(([id]) => id === value)?.[1] ?? options[0]?.[1] ?? "";
  return (
    <span className="relative flex max-w-[48vw] min-w-0 items-center justify-end gap-1 text-right text-[15px] text-secondary sm:max-w-[260px]">
      <span className="min-w-0 truncate">{current}</span>
      <ChevronRight size={17} className="shrink-0 text-tertiary" />
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
      className="h-9 w-[56%] min-w-0 shrink-0 bg-transparent text-right text-[15px] text-secondary outline-none placeholder:text-tertiary"
    />
  );
}

function InlineButton({ children, onClick, destructive, disabled }: { children: ReactNode; onClick: () => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`settings-action-row flex min-h-11 w-full items-center px-4 text-left text-[15px] font-medium active:bg-elev-2 disabled:opacity-45 ${destructive ? "text-danger" : "text-accent"}`}
    >
      {children}
    </button>
  );
}

function RootRow({ label, active, onOpen, icon }: { label: string; active?: boolean; onOpen: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      className="settings-root-row relative flex w-full items-center justify-between gap-3 bg-transparent px-4 text-left active:bg-elev-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="settings-root-icon flex shrink-0 items-center justify-center text-secondary">{icon}</span>
        <span className="truncate text-[15px] font-medium text-primary">{label}</span>
      </div>
      <ChevronRight size={18} className="shrink-0 text-tertiary" />
    </button>
  );
}

function Disclosure({ title, detail, open, onToggle, children }: {
  title: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="settings-row flex w-full items-center gap-3 bg-transparent px-4 text-left active:bg-elev-2">
        <div className="min-w-0 flex-1">
          <div className="settings-row-label text-primary">{title}</div>
          {detail ? <div className="settings-row-description mt-0.5 text-tertiary">{detail}</div> : null}
        </div>
        <ChevronDown size={18} className={`shrink-0 text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-[var(--border-subtle)]">{children}</div> : null}
    </div>
  );
}

function ThemeCard({ theme, active, onClick, label }: { theme: ThemePreference; active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="flex w-[82px] flex-col items-center gap-2 rounded-xl bg-transparent p-1 active:scale-[0.98]">
      <div className={`h-[58px] w-[44px] overflow-hidden rounded-[9px] border-2 p-1 ${active ? "border-accent" : "border-[var(--border-subtle)]"}`}>
        {theme === "light" ? <div className="h-full w-full rounded-[5px] bg-[#FAF9F5]" /> : null}
        {theme === "dark" ? <div className="h-full w-full rounded-[5px] bg-[#121214]" /> : null}
        {theme === "system" ? (
          <div className="flex h-full w-full overflow-hidden rounded-[5px]"><div className="w-1/2 bg-[#FAF9F5]" /><div className="w-1/2 bg-[#121214]" /></div>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`text-[13px] ${active ? "font-medium text-primary" : "text-tertiary"}`}>{label}</span>
        {active ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white"><Check size={10} strokeWidth={3} /></span> : null}
      </div>
    </button>
  );
}

function applyThemeBeforePreferenceUpdate(theme: ThemePreference) {
  const next = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme;
  document.documentElement.dataset.theme = next;
  document.documentElement.classList.toggle("dark", next === "dark");
  localStorage.setItem("navi.theme.v3", next);
}

export function SettingsSheet({
  open,
  initialSection,
  durability,
  preferences,
  localChatCount,
  onClose,
  onPreferences,
  onOpenConnectors,
  onClearData,
  onExport
}: Props) {
  const [page, setPage] = useState<PageId>("root");
  const pageHistory = useRef<PageId[]>([]);
  const wasOpen = useRef(false);
  const [diagnosticsTaps, setDiagnosticsTaps] = useState(0);
  const lastTapAt = useRef(0);
  const [account, setAccount] = useState<AccountState>({ signedIn: false, ready: false, name: "", email: "" });
  const [facts, setFacts] = useState<{ loaded: boolean; configured: boolean; items: Array<{ id: string; fact: string }> }>({ loaded: false, configured: false, items: [] });
  const [memoryStatus, setMemoryStatus] = useState<{
    loaded: boolean; configured: boolean; signedIn: boolean;
    chats: number; facts: number; skills: number; lessons: number; skillNames: string[]; lessonNames: string[];
  }>({ loaded: false, configured: false, signedIn: false, chats: 0, facts: 0, skills: 0, lessons: 0, skillNames: [], lessonNames: [] });
  const [teach, setTeach] = useState<{ name: string; instructions: string; saving: boolean; status: { ok: boolean; message: string } | null }>({ name: "", instructions: "", saving: false, status: null });
  const [playbookDraft, setPlaybookDraft] = useState("");
  const [playbookNotice, setPlaybookNotice] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [playbooksOpen, setPlaybooksOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [micTest, setMicTest] = useState<{ running: boolean; step: string; checks: MicCheck[] }>({ running: false, step: "", checks: [] });
  const [systemChecks, setSystemChecks] = useState<{ running: boolean; results: Array<{ area: string; ok: boolean; detail: string }> }>({ running: false, results: [] });
  const [evalState, setEvalState] = useState<{ phase: "idle" | "running" | "done" | "error"; message: string }>({
    phase: "idle",
    message: "Scores Navi Soul against a fixed task set. Takes a couple of minutes."
  });

  const skillGroups = useMemo(() => categories()
    .map((group) => ({ ...group, skills: group.skills.filter((skill: Skill) => isImplemented(skill.id)) }))
    .filter((group) => group.skills.length), []);
  const builtInSkillCount = useMemo(() => skillGroups.reduce((sum, group) => sum + group.skills.length, 0), [skillGroups]);

  const cloudReady = memoryStatus.loaded && memoryStatus.configured;
  const syncedDescription = !memoryStatus.loaded
    ? "Checking sync status…"
    : cloudReady
      ? "Chats and preferences sync to your private cloud memory."
      : "Cloud memory is not configured on this deployment.";

  useEffect(() => {
    if (open && !wasOpen.current) {
      setPage(normalizeInitialPage(initialSection));
      pageHistory.current = [];
    }
    if (!open && wasOpen.current) pageHistory.current = [];
    wasOpen.current = open;
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    if (!CLERK_AVAILABLE) {
      setAccount({ signedIn: false, ready: true, name: "", email: "" });
      return;
    }
    const read = () => {
      const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
      if (!clerk?.loaded) return false;
      const user = clerk.user;
      const joined = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
      setAccount({
        signedIn: Boolean(user),
        ready: true,
        name: user?.fullName?.trim() || joined,
        email: user?.primaryEmailAddress?.emailAddress ?? ""
      });
      return true;
    };
    if (read()) return;
    const poll = window.setInterval(() => { if (read()) window.clearInterval(poll); }, 250);
    const stop = window.setTimeout(() => {
      window.clearInterval(poll);
      setAccount((current) => ({ ...current, ready: true }));
    }, 5_000);
    return () => { window.clearInterval(poll); window.clearTimeout(stop); };
  }, [open]);

  useEffect(() => {
    if (!open || (page !== "privacy" && page !== "capabilities" && page !== "profile")) return;
    void fetch("/api/memory/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { configured?: boolean; signedIn?: boolean; chats?: number; facts?: number; skills?: number; lessons?: number; skillNames?: string[]; lessonNames?: string[] } | null) => {
        setMemoryStatus({
          loaded: true,
          configured: data?.configured === true,
          signedIn: data?.signedIn === true,
          chats: data?.chats ?? 0,
          facts: data?.facts ?? 0,
          skills: data?.skills ?? 0,
          lessons: data?.lessons ?? 0,
          skillNames: Array.isArray(data?.skillNames) ? data.skillNames : [],
          lessonNames: Array.isArray(data?.lessonNames) ? data.lessonNames : []
        });
      })
      .catch(() => setMemoryStatus((current) => ({ ...current, loaded: true })));
  }, [open, page]);

  useEffect(() => {
    if (!open || page !== "privacy") return;
    void fetch("/api/memory/facts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { configured?: boolean; facts?: Array<{ id: string; fact: string }> } | null) => {
        setFacts({ loaded: true, configured: data?.configured === true, items: data?.facts ?? [] });
      })
      .catch(() => setFacts((current) => ({ ...current, loaded: true })));
  }, [open, page]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receive);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receive);
  }, []);

  if (!open) return null;

  const update = (patch: Partial<NaviPreferences>) => {
    onPreferences({ ...preferences, ...patch });
    haptic("selection", preferences.haptics);
  };

  const updateProfile = (patch: Partial<NaviPreferences["profile"]>) => {
    onPreferences({ ...preferences, profile: { ...preferences.profile, ...patch } });
  };

  const openPage = (next: PageId) => {
    if (next === page) return;
    pageHistory.current.push(page);
    setPage(next);
    if (next === "general" || next === "privacy" || next === "capabilities") {
      onPreferences({ ...preferences, lastMenuSection: next as MenuSection });
    }
    haptic("selection", preferences.haptics);
  };

  const goBack = () => {
    const previous = pageHistory.current.pop() ?? "root";
    setPage(previous);
    haptic("selection", preferences.haptics);
  };

  const updateBusy = updateStatus.phase === "checking" || updateStatus.phase === "downloading" || updateStatus.phase === "restarting";
  const profileName = preferences.profile.fullName.trim() || account.name || preferences.profile.displayName.trim() || "Profile";
  const profileInitial = profileName === "Profile" ? "S" : profileName[0]?.toUpperCase() || "S";

  async function signOut() {
    const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
    try { await clerk?.signOut?.(); } finally { window.location.href = "/sign-in"; }
  }

  function signIn() {
    haptic("impact-light", preferences.haptics);
    window.location.href = "/sign-in";
  }

  function revealDiagnostics() {
    const now = Date.now();
    const next = now - lastTapAt.current > DIAGNOSTICS_TAP_WINDOW_MS ? 1 : diagnosticsTaps + 1;
    lastTapAt.current = now;
    if (next >= DIAGNOSTICS_TAPS) {
      setDiagnosticsTaps(0);
      pageHistory.current.push(page);
      setPage("diagnostics");
      haptic("success", preferences.haptics);
      return;
    }
    setDiagnosticsTaps(next);
    if (next > 1) haptic("selection", preferences.haptics);
  }

  async function saveSkill() {
    if (!teach.name.trim() || !teach.instructions.trim()) return;
    setTeach((current) => ({ ...current, saving: true, status: null }));
    try {
      const response = await fetch("/api/memory/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teach.name.trim(), instructions: teach.instructions.trim() })
      });
      const data = await response.json().catch(() => null) as { error?: string; skill?: { name?: string } } | null;
      if (!response.ok || !data?.skill) {
        setTeach((current) => ({ ...current, saving: false, status: { ok: false, message: data?.error ?? `The store answered ${response.status}.` } }));
        return;
      }
      setTeach({ name: "", instructions: "", saving: false, status: { ok: true, message: `Saved “${data.skill.name}”.` } });
      setMemoryStatus((current) => ({ ...current, skills: current.skills + 1, skillNames: [...current.skillNames, data.skill?.name ?? "New skill"] }));
    } catch (error) {
      setTeach((current) => ({ ...current, saving: false, status: { ok: false, message: error instanceof Error ? error.message : "The request never completed." } }));
    }
  }

  async function forget(id: string) {
    haptic("impact-light", preferences.haptics);
    const response = await fetch(`/api/memory/facts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) setFacts((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
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

  async function runMicTest() {
    setMicTest({ running: true, step: "Starting", checks: [] });
    try {
      const checks = await diagnoseMicrophone((step) => setMicTest((current) => ({ ...current, step })));
      setMicTest({ running: false, step: "", checks });
    } catch (error) {
      setMicTest({ running: false, step: "", checks: [{ step: "Test", ok: false, detail: error instanceof Error ? error.message : "The test could not run." }] });
    }
  }

  async function runChecks() {
    setSystemChecks({ running: true, results: [] });
    try {
      const response = await fetch("/api/system/diagnostics", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { checks?: Array<{ area: string; ok: boolean; detail: string }> } | null;
      setSystemChecks({ running: false, results: data?.checks ?? [{ area: "Diagnostics", ok: false, detail: `The check route answered ${response.status}.` }] });
    } catch (error) {
      setSystemChecks({ running: false, results: [{ area: "Diagnostics", ok: false, detail: error instanceof Error ? error.message : "The request never completed." }] });
    }
  }

  async function runEvals() {
    haptic("impact-light", preferences.haptics);
    setEvalState({ phase: "running", message: "Running… keep the app open." });
    try {
      const response = await fetch("/api/eval", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(`The run could not start (HTTP ${response.status}).`);
      const data = await response.json() as { passed: number; ran: number; meaningful: boolean; durationMs: number };
      if (!data.meaningful) {
        setEvalState({ phase: "error", message: `All ${data.ran} tasks failed. Check provider keys.` });
        return;
      }
      setEvalState({ phase: "done", message: `${data.passed}/${data.ran} passed in ${Math.round(data.durationMs / 1000)}s.` });
    } catch (error) {
      setEvalState({ phase: "error", message: error instanceof Error ? error.message : "The run did not complete." });
    }
  }

  return (
    <div className="settings-dialog fixed inset-0 z-[95] flex flex-col bg-page" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="navi-sheet-header sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-page px-2 pb-1 pt-[max(var(--safe-top),env(safe-area-inset-top))]">
        <div className="flex w-24 items-center justify-start">
          {page === "root" ? <div className="h-11 w-11" aria-hidden="true" /> : (
            <button type="button" onClick={goBack} aria-label="Back to Settings" className="flex h-11 items-center text-accent active:opacity-60 md:hidden">
              <ChevronLeft size={26} strokeWidth={1.6} />
              <span className="-ml-1 text-[15px] font-medium">Back</span>
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-primary md:pl-4 md:text-left">
          {page === "root" ? "Settings" : PAGE_TITLES[page]}
        </div>
        <div className="flex w-24 items-center justify-end">
          <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-11 items-center justify-end pr-3 text-[16px] font-semibold text-accent active:opacity-60">Done</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <nav aria-label="Settings sections" className={`min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:block md:w-[264px] md:border-r md:border-[var(--border-subtle)] ${page === "root" ? "block" : "hidden"}`}>
          <div className="settings-root-title px-4 md:hidden"><h2 className="text-[30px] font-semibold tracking-[-0.03em] text-primary">Settings</h2></div>

          <div className="mt-3">
            <Group>
              <button type="button" onClick={() => openPage("profile")} className="settings-profile-row flex w-full items-center justify-between gap-3 bg-transparent px-4 text-left active:bg-elev-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="settings-profile-avatar flex shrink-0 items-center justify-center rounded-full bg-elev-3 text-[17px] font-semibold text-primary">{profileInitial}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-medium text-primary">{profileName}</div>
                    <div className="mt-0.5 truncate text-[12px] text-tertiary">Profile and preferences</div>
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-tertiary" />
              </button>
            </Group>
          </div>

          <Group>
            <RootRow label="General" active={page === "general"} onOpen={() => openPage("general")} icon={<Settings size={18} strokeWidth={1.8} />} />
            <Divider inset />
            <RootRow label="Connectors" onOpen={() => { onOpenConnectors(); haptic("selection", preferences.haptics); }} icon={<Link2 size={18} strokeWidth={1.8} />} />
            <Divider inset />
            <RootRow label="Capabilities" active={page === "capabilities"} onOpen={() => openPage("capabilities")} icon={<FlaskConical size={18} strokeWidth={1.8} />} />
          </Group>

          <Group>
            <RootRow label="Memory & Storage" active={page === "privacy"} onOpen={() => openPage("privacy")} icon={<Shield size={18} strokeWidth={1.8} />} />
          </Group>

          <button type="button" onClick={revealDiagnostics} className="w-full px-4 py-5 text-center text-[12px] text-tertiary" aria-label={`NaviOS ${versionLabel()}`}>
            NaviOS · {versionLabel()}
            {diagnosticsTaps > 1 && diagnosticsTaps < DIAGNOSTICS_TAPS ? <span className="ml-2">{DIAGNOSTICS_TAPS - diagnosticsTaps} more</span> : null}
          </button>
        </nav>

        <div className={`min-h-0 w-full flex-1 overflow-y-auto overscroll-contain pb-[calc(28px+var(--safe-bottom))] ${page === "root" ? "hidden md:block" : "block"}`}>
          {page === "profile" ? (
            <div className="settings-page pb-8">
              <div className="settings-profile-hero mx-4 mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-elev-1 p-3">
                <div className="settings-profile-avatar flex shrink-0 items-center justify-center rounded-full bg-elev-3 text-[18px] font-semibold text-primary">{profileInitial}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-semibold text-primary">{profileName}</div>
                  <div className="mt-0.5 text-[12px] text-tertiary">{account.ready ? (account.signedIn ? "Signed in" : "Local profile") : "Checking account…"}</div>
                </div>
              </div>

              <SectionHeader>Personal</SectionHeader>
              <Group>
                <Row label="Full name" control={<TextField label="Full name" value={preferences.profile.fullName} onChange={(fullName) => updateProfile({ fullName })} placeholder={account.name || "Your name"} />} />
                <Divider />
                <Row label="Display name" control={<TextField label="Display name" value={preferences.profile.displayName} onChange={(displayName) => updateProfile({ displayName })} placeholder="First name" />} />
                <Divider />
                <Row label="Work" control={<BareSelect label="Work" value={preferences.profile.work} options={WORK_OPTIONS} onChange={(work) => updateProfile({ work })} />} />
              </Group>

              <SectionHeader>Navi Soul</SectionHeader>
              <Group>
                <div className="p-3">
                  <label className="mb-1.5 block text-[13px] font-medium text-secondary" htmlFor="navi-profile-instructions">Instructions</label>
                  <textarea
                    id="navi-profile-instructions"
                    aria-label="Instructions for Navi Soul"
                    value={preferences.profile.instructions}
                    onChange={(event) => updateProfile({ instructions: event.target.value.slice(0, 4_000) })}
                    placeholder="How should Navi work with you?"
                    rows={3}
                    className="min-h-[76px] w-full resize-y rounded-[10px] border border-[var(--border-subtle)] bg-elev-2 px-3 py-2 text-[14px] leading-5 text-primary outline-none placeholder:text-tertiary focus:border-accent"
                  />
                </div>
              </Group>

              {CLERK_AVAILABLE ? (
                <SectionHeader>Account</SectionHeader>
              ) : null}
              {CLERK_AVAILABLE ? (
                <Group>
                  {account.ready && account.signedIn ? (
                    <>
                      <Row label="Signed in" description={syncedDescription} />
                      <Divider />
                      <InlineButton destructive onClick={() => void signOut()}>Log out</InlineButton>
                    </>
                  ) : (
                    <InlineButton onClick={signIn}>Sign in with Google or GitHub</InlineButton>
                  )}
                </Group>
              ) : null}
            </div>
          ) : null}

          {page === "general" ? (
            <div className="settings-page pb-8">
              <SectionHeader>Appearance</SectionHeader>
              <div className="mx-4 flex justify-center gap-4 py-2">
                <ThemeCard theme="light" active={preferences.theme === "light"} onClick={() => { applyThemeBeforePreferenceUpdate("light"); update({ theme: "light" }); }} label="Light" />
                <ThemeCard theme="dark" active={preferences.theme === "dark"} onClick={() => { applyThemeBeforePreferenceUpdate("dark"); update({ theme: "dark" }); }} label="Dark" />
                <ThemeCard theme="system" active={preferences.theme === "system"} onClick={() => { applyThemeBeforePreferenceUpdate("system"); update({ theme: "system" }); }} label="System" />
              </div>

              <SectionHeader>Display</SectionHeader>
              <Group>
                <Row label="Chat font" control={<BareSelect label="Chat font" value={preferences.chatFont} options={[["serif", "NaviOS Serif"], ["sans", "System"]]} onChange={(value) => update({ chatFont: value === "sans" ? "sans" : "serif" })} />} />
                <Divider />
                <Row label="Motion" control={<TextSegmented label="Motion" value={preferences.motion} options={[{ id: "full" as const, name: "System" }, { id: "reduced" as const, name: "Reduced" }]} onChange={(motion) => update({ motion })} />} />
                <Divider />
                <Row label="Density" control={<TextSegmented label="Density" value={preferences.density} options={[{ id: "comfortable" as const, name: "Comfortable" }, { id: "compact" as const, name: "Compact" }]} onChange={(density) => update({ density })} />} />
              </Group>

              <SectionHeader>Device & App</SectionHeader>
              <Group>
                <RootRow label="Permissions" onOpen={() => openPage("permissions")} icon={<Key size={18} strokeWidth={1.8} />} />
                <Divider inset />
                <RootRow label="Voice" onOpen={() => openPage("voice")} icon={<Volume2 size={18} strokeWidth={1.8} />} />
                <Divider inset />
                <Row label="Haptic feedback" control={<SettingsToggle label="Haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />} />
              </Group>

              <SectionHeader>App</SectionHeader>
              <Group>
                <Row
                  label="Update NaviOS"
                  description={updateStatus.message}
                  control={<RefreshCw size={17} className={`text-tertiary ${updateBusy ? "animate-spin" : ""}`} />}
                  onClick={() => { haptic("impact-light", preferences.haptics); setUpdateStatus({ phase: "checking", message: "Checking for the newest version…" }); requestPwaUpdate(); }}
                />
                <Divider />
                <InlineButton destructive onClick={() => { if (window.confirm("Clear all NaviOS history, projects, and settings from this device?")) { onClearData(); onClose(); } }}>Clear local data</InlineButton>
              </Group>
            </div>
          ) : null}

          {page === "permissions" ? (
            <div className="settings-page pb-8">
              <SectionHeader>Permissions</SectionHeader>
              <Group>
                <Row label="Notifications" control={<SettingsToggle label="Notifications" value={preferences.notifyOnComplete} onChange={() => void enableNotifications()} />} />
                <Divider />
                <Row label="Camera" description="Managed by Safari or your device settings." control={<Camera size={17} className="text-tertiary" />} />
                <Divider />
                <Row label="Microphone" description="Requested only when you use voice input." control={<Mic size={17} className="text-tertiary" />} />
              </Group>
            </div>
          ) : null}

          {page === "voice" ? (
            <div className="settings-page pb-8">
              <SectionHeader>Voice</SectionHeader>
              <Group>
                <Row label="Language" control={<BareSelect label="Voice language" value={preferences.voiceLanguage} options={VOICE_LANGUAGES} onChange={(voiceLanguage) => update({ voiceLanguage })} />} />
                <Divider />
                <Row label="Speaking rate" control={(
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="range" min={MIN_VOICE_RATE} max={MAX_VOICE_RATE} step={0.05} value={preferences.voiceRate} onChange={(event) => update({ voiceRate: clampVoiceRate(Number(event.target.value)) })} className="w-28 accent-[var(--accent)]" />
                    <span className="w-10 text-right text-[13px] tabular-nums text-secondary">{preferences.voiceRate.toFixed(2)}×</span>
                  </span>
                )} />
                <Divider />
                <InlineButton onClick={() => void runMicTest()}>{micTest.running ? "Testing microphone…" : "Test microphone"}</InlineButton>
              </Group>
              {micTest.running || micTest.checks.length ? (
                <Group>
                  <div className="space-y-2 p-3">
                    {micTest.running ? <p className="text-[13px] text-secondary">{micTest.step}…</p> : micTest.checks.map((check) => (
                      <div key={check.step} className="flex gap-2 text-[13px]"><span className={check.ok ? "text-success" : "text-danger"}>{check.ok ? "✓" : "✕"}</span><span className="text-secondary"><strong className="font-medium text-primary">{check.step}</strong> · {check.detail}</span></div>
                    ))}
                  </div>
                </Group>
              ) : null}
            </div>
          ) : null}

          {page === "capabilities" ? (
            <div className="settings-page pb-8">
              <SectionHeader>Tools</SectionHeader>
              <Group>
                <Row label="Web search" description="Use current information when a request needs it." control={<SettingsToggle label="Web search" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />} />
                <Divider />
                <Row label="Artifacts" description="Create interactive visual and document outputs." control={<SettingsToggle label="Artifacts" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />} />
                <Divider />
                <Row label="Code execution" description="Run code in the isolated workspace when needed." control={<SettingsToggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />} />
              </Group>

              <SectionHeader>Skills</SectionHeader>
              <Group>
                <Disclosure title="Teach a new skill" detail="Give Navi Soul a reusable instruction." open={teachOpen} onToggle={() => setTeachOpen((value) => !value)}>
                  <div className="space-y-2 p-3">
                    <input aria-label="Skill name" value={teach.name} onChange={(event) => setTeach({ ...teach, name: event.target.value.slice(0, 120), status: null })} placeholder="Skill name" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[14px] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                    <textarea aria-label="Skill instructions" value={teach.instructions} onChange={(event) => setTeach({ ...teach, instructions: event.target.value.slice(0, 24_000), status: null })} rows={3} placeholder="What should Navi know or do?" className="w-full resize-y rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 py-2 text-[14px] leading-5 text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void saveSkill()} disabled={teach.saving || !teach.name.trim() || !teach.instructions.trim()} className="h-9 rounded-[9px] bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-45">{teach.saving ? "Saving…" : "Teach Navi"}</button>
                      {teach.status ? <span className={`text-[12px] ${teach.status.ok ? "text-success" : "text-danger"}`}>{teach.status.message}</span> : null}
                    </div>
                  </div>
                </Disclosure>
                <Divider inset={false} />
                <Disclosure title="Built-in skills" detail={`${builtInSkillCount} available`} open={skillsOpen} onToggle={() => setSkillsOpen((value) => !value)}>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {skillGroups.flatMap((group) => group.skills).map((skill: Skill) => (
                      <div key={skill.id} className="px-4 py-2.5"><div className="text-[14px] font-medium text-primary">{skill.triggers.slash}</div><div className="mt-0.5 text-[12px] leading-4 text-tertiary">{skill.description}</div></div>
                    ))}
                  </div>
                </Disclosure>
                {(memoryStatus.skillNames.length > 0 || memoryStatus.lessonNames.length > 0) ? (
                  <>
                    <Divider inset={false} />
                    <Disclosure title="Learned by Navi Soul" detail={`${memoryStatus.skills + memoryStatus.lessons} remembered`} open={false} onToggle={() => setSkillsOpen(true)}>
                      <div className="p-3 text-[12px] text-tertiary">
                        {memoryStatus.skillNames.length ? <div><strong className="text-secondary">Taught by you:</strong> {memoryStatus.skillNames.join(" · ")}</div> : null}
                        {memoryStatus.lessonNames.length ? <div className="mt-1"><strong className="text-secondary">Learned from its own work:</strong> {memoryStatus.lessonNames.join(" · ")}</div> : null}
                      </div>
                    </Disclosure>
                  </>
                ) : null}
              </Group>

              <SectionHeader>Playbooks</SectionHeader>
              <Group>
                <Disclosure title="Playbooks" detail={`${preferences.customPlaybooks.length} custom · ${BUILT_IN_PLAYBOOKS.length} built in`} open={playbooksOpen} onToggle={() => setPlaybooksOpen((value) => !value)}>
                  <div className="space-y-3 p-3">
                    <textarea aria-label="Paste a SKILL.md file" value={playbookDraft} onChange={(event) => { setPlaybookDraft(event.target.value); setPlaybookNotice(null); }} placeholder="Paste a SKILL.md playbook…" rows={3} className="w-full resize-y rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 py-2 font-mono text-[12px] text-primary outline-none placeholder:text-tertiary" />
                    <button type="button" disabled={!playbookDraft.trim()} onClick={() => {
                      const result = parseSkillMarkdown(playbookDraft);
                      if ("error" in result) { setPlaybookNotice(result.error); haptic("error", preferences.haptics); return; }
                      const next = preferences.customPlaybooks.filter((entry) => entry.id !== result.playbook.id);
                      update({ customPlaybooks: [...next, result.playbook].slice(0, 40) });
                      setPlaybookDraft("");
                      setPlaybookNotice(result.truncated ? `Added “${result.playbook.name}”, trimmed to 4,000 characters.` : `Added “${result.playbook.name}”.`);
                    }} className="h-9 rounded-[9px] bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-45">Add playbook</button>
                    {playbookNotice ? <div className="text-[12px] text-secondary">{playbookNotice}</div> : null}
                    {preferences.customPlaybooks.length ? <div className="divide-y divide-[var(--border-subtle)] rounded-[9px] border border-[var(--border-subtle)]">{preferences.customPlaybooks.map((entry) => <div key={entry.id} className="flex items-center gap-3 px-3 py-2"><span className="min-w-0 flex-1 truncate text-[13px] text-primary">{entry.name}</span><button type="button" onClick={() => update({ customPlaybooks: preferences.customPlaybooks.filter((item) => item.id !== entry.id) })} className="text-[12px] text-danger">Remove</button></div>)}</div> : null}
                    <div className="text-[12px] text-tertiary">Built in: {BUILT_IN_PLAYBOOKS.map((entry) => entry.name).join(" · ")}</div>
                  </div>
                </Disclosure>
              </Group>
            </div>
          ) : null}

          {page === "privacy" ? (
            <div className="settings-page pb-8">
              <p className="mx-4 mt-4 text-[13px] leading-5 text-tertiary">Control what stays on this device and what can sync to your private account memory.</p>

              <SectionHeader>Memory</SectionHeader>
              <Group>
                <Row label="Local history" description={DURABILITY_DETAIL[durability]} control={<SettingsToggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />} />
                <Divider />
                <Row label="Memory" description="Let new chats draw on relevant earlier conversations." control={<SettingsToggle label="Memory" value={preferences.memory} onChange={() => update({ memory: !preferences.memory })} />} />
              </Group>

              <SectionHeader>On this device</SectionHeader>
              <Group>
                <Row label="Conversations" description={preferences.saveHistory ? "Stored in this browser." : "Local history is off."} control={<Count value={localChatCount} />} />
              </Group>

              <SectionHeader>Synced to your account</SectionHeader>
              <Group>
                {!memoryStatus.loaded ? <Row label="Reading your memory…" /> : !memoryStatus.configured ? <Row label="Cloud memory is off" description="Nothing leaves this device." /> : !memoryStatus.signedIn ? <Row label="Signed out" description="Sign in to sync chats, facts, and skills." /> : (
                  <>
                    <Row label="Conversations" description="Restored on devices you sign in to." control={<Count value={memoryStatus.chats} />} />
                    <Divider />
                    <Row label="Facts about you" control={<Count value={memoryStatus.facts} />} />
                    <Divider />
                    <Row label="Skills you taught it" control={<Count value={memoryStatus.skills} />} />
                    <Divider />
                    <Row label="Lessons it worked out" control={<Count value={memoryStatus.lessons} />} />
                  </>
                )}
              </Group>

              <SectionHeader>Facts about you</SectionHeader>
              <Group>
                <Disclosure title="Stored facts" detail={!facts.loaded ? "Loading…" : !facts.configured ? "Not enabled" : !facts.items.length ? "Nothing yet" : `${facts.items.length} saved`} open={factsOpen} onToggle={() => setFactsOpen((value) => !value)}>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {!facts.loaded ? <div className="p-3 text-[13px] text-tertiary">Loading…</div> : !facts.configured ? <div className="p-3 text-[13px] text-tertiary">Not enabled. Durable facts are not configured on this deployment.</div> : !facts.items.length ? <div className="p-3 text-[13px] text-tertiary">Nothing yet. Standing facts you mention can appear here.</div> : facts.items.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 px-4 py-2.5"><span className="min-w-0 flex-1 text-[13px] leading-5 text-primary">{item.fact}</span><button type="button" onClick={() => void forget(item.id)} className="shrink-0 text-[12px] font-medium text-danger">Forget</button></div>
                    ))}
                  </div>
                </Disclosure>
              </Group>

              <SectionHeader>Your data</SectionHeader>
              <Group><InlineButton onClick={() => { haptic("selection", preferences.haptics); onExport(); }}>Export data</InlineButton></Group>
            </div>
          ) : null}

          {page === "diagnostics" ? (
            <div className="settings-page pb-8">
              <SectionHeader>Check everything</SectionHeader>
              <Group>
                <InlineButton onClick={() => void runChecks()}>{systemChecks.running ? "Checking…" : "Run all checks"}</InlineButton>
                {systemChecks.results.length ? <div className="space-y-2 border-t border-[var(--border-subtle)] p-3">{systemChecks.results.map((entry) => <div key={entry.area} className="flex gap-2 text-[12px]"><span className={entry.ok ? "text-success" : "text-danger"}>{entry.ok ? "✓" : "✕"}</span><span className="text-secondary"><strong className="font-medium text-primary">{entry.area}</strong> · {entry.detail}</span></div>)}</div> : null}
              </Group>

              <SectionHeader>Deployment variables</SectionHeader>
              <Group>
                {[
                  ["GITHUB_PAT / NAVI_GITHUB_TOKEN", "Lets Navi Soul read and commit to this app's own repository."],
                  ["NAVI_SELF_UPDATE_BRANCH", `Which branch self-edits commit to. Defaults to ${DEFAULT_SELF_UPDATE_BRANCH}.`],
                  ["GOOGLE_OAUTH_CLIENT_ID / _SECRET", "Per-person Gmail and Calendar."],
                  ["GITHUB_OAUTH_CLIENT_ID / _SECRET", "Per-person GitHub."],
                  ["NAVI_VERCEL_TOKEN", "Deployment and build-log reads."],
                  ["MCP_SERVER_REGISTRY_JSON", "Remote connector servers."],
                  ["HF_TOKEN", "Voice transcription, image and audio generation."]
                ].map(([name, detail], index, array) => <div key={name}><Row label={name} description={detail} />{index < array.length - 1 ? <Divider /> : null}</div>)}
              </Group>

              <SectionHeader>Routing</SectionHeader>
              <Group>
                <Row label="Pin an engine" description="Automatic routing is recommended." control={<BareSelect label="Pin an engine" value={preferences.routeOverride ?? "navi-soul"} options={DIAGNOSTIC_ROUTES.map((route) => [route.id, route.label] as [string, string])} onChange={(value) => update({ routeOverride: value === "navi-soul" ? undefined : value as NaviPreferences["routeOverride"] })} />} />
                {preferences.routeOverride ? <><Divider /><InlineButton destructive onClick={() => update({ routeOverride: undefined })}>Clear pin</InlineButton></> : null}
              </Group>

              <SectionHeader>Measurement</SectionHeader>
              <Group><Row label="Run quality check" description={evalState.message} control={<FlaskConical size={17} className={evalState.phase === "running" ? "animate-pulse text-accent" : "text-tertiary"} />} onClick={() => void runEvals()} /></Group>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
