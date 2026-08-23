"use client";

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Key,
  Link2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  Smartphone,
  Sun,
  Volume2,
  X,
  Check,
  Bell,
  Camera as CameraIcon,
  Mic as MicIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences } from "@/lib/ai/types";
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

const DIAGNOSTICS_TAPS = 5;
const DIAGNOSTICS_TAP_WINDOW_MS = 3_000;

const DEFAULT_UPDATE_STATUS: PwaUpdateStatus = {
  phase: "idle",
  message: "Checks for the latest version and applies it."
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
  diagnostics: "Diagnostics",
  profile: "Profile",
  general: "General",
  privacy: "Memory and storage",
  capabilities: "Capabilities",
  voice: "Voice",
  permissions: "Permissions"
};

const DURABILITY_DETAIL: Record<StorageDurability, string> = {
  persisted: "Stored on this device and protected from automatic cleanup",
  "best-effort": "Stored on this device · the browser may clear it if space runs low",
  unavailable: "Stored on this device · export regularly, this browser cannot protect it"
};

const CLERK_AVAILABLE = process.env.NEXT_PUBLIC_NAVI_AUTH === "on";

type ClerkGlobal = {
  loaded?: boolean;
  user?: { primaryEmailAddress?: { emailAddress?: string } } | null;
  signOut?: () => Promise<void>;
};

type AccountState = { email: string; signedIn: boolean; ready: boolean };

function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-6 px-4 text-[0.8125rem] font-medium text-tertiary uppercase tracking-wide">{children}</h3>;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-6 overflow-hidden rounded-[10px] bg-elev-2">{children}</div>;
}

function Row({ label, description, control, fullWidthControl }: {
  label: string;
  description?: ReactNode;
  control?: ReactNode;
  fullWidthControl?: ReactNode;
}) {
  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3 active:bg-elev-3 transition-colors">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[1rem]/[1.375rem] text-primary">{label}</span>
        {control}
      </div>
      {description ? <p className="mt-1 text-[0.8125rem]/[1.125rem] text-tertiary">{description}</p> : null}
      {fullWidthControl ? <div className="mt-3">{fullWidthControl}</div> : null}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-[1rem]/[1.375rem] tabular-nums text-secondary">{value}</span>;
}

export function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-[120ms] ${value ? "bg-[#0A84FF]" : "bg-[#39393D]"}`}
    >
      <span className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-sm transition-transform duration-[140ms] ${value ? "translate-x-[20px]" : "translate-x-0"}`} />
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
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-md bg-elev-3 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-[28px] rounded-md px-3 text-[0.8125rem] font-medium transition-colors duration-[100ms] ${value === option.id ? "bg-elev-1 text-primary shadow-sm" : "text-tertiary"}`}
        >
          {option.name}
        </button>
      ))}
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
    <span className="relative flex shrink-0 items-center gap-1.5 text-[1rem]/5 text-secondary">
      {current}
      <ChevronRight size={16} className="text-tertiary" />
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
      className="h-10 w-[55%] min-w-0 shrink-0 rounded-[8px] bg-elev-3 px-3 text-right text-[1rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-4"
    />
  );
}

function InlineButton({ children, onClick, destructive }: { children: ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-[8px] bg-elev-3 px-4 text-[0.875rem]/5 font-medium active:bg-elev-4 ${destructive ? "text-[#FF453A]" : "text-primary"}`}
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
      className={`flex min-h-[44px] w-full items-center justify-between border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-2 text-left active:bg-elev-3`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-[1rem]/[1.375rem] text-primary">{label}</span>
      </div>
      <ChevronRight size={20} className="text-tertiary" />
    </button>
  );
}

function ThemeCard({ theme, active, onClick, label }: { theme: "light" | "dark" | "system", active: boolean, onClick: () => void, label: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-center gap-2 p-2 rounded-[14px] active:scale-95 transition-all ${active ? "bg-elev-2" : "bg-transparent"}`}>
      <div className={`w-[54px] h-[72px] rounded-[10px] overflow-hidden flex flex-col p-1.5 shadow-sm border ${active ? "border-[#0A84FF] ring-2 ring-[#0A84FF]/20" : "border-[var(--border-strong)]"}`}>
         {theme === "light" && <div className="w-full h-full bg-[#FFFFFF] rounded-md shadow-sm border border-black/5" />}
         {theme === "dark" && <div className="w-full h-full bg-[#1C1C1E] rounded-md shadow-sm border border-white/5" />}
         {theme === "system" && (
            <div className="w-full h-full rounded-md shadow-sm border border-black/5 flex overflow-hidden">
              <div className="w-1/2 h-full bg-[#FFFFFF]" />
              <div className="w-1/2 h-full bg-[#1C1C1E]" />
            </div>
         )}
      </div>
      <div className="flex flex-col items-center gap-1 mt-1">
        <span className={`text-[0.8125rem] ${active ? "font-medium text-primary" : "text-tertiary"}`}>{label}</span>
        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${active ? "border-[#0A84FF] bg-[#0A84FF] text-white" : "border-tertiary"}`}>
          {active && <Check size={10} strokeWidth={3} />}
        </div>
      </div>
    </button>
  )
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
  const router = useRouter();
  const [page, setPage] = useState<PageId>("root");
  const [oauthNotice, setOauthNotice] = useState("");
  const [diagnosticsTaps, setDiagnosticsTaps] = useState(0);
  const [facts, setFacts] = useState<{ loaded: boolean; configured: boolean; items: Array<{ id: string; fact: string }> }>({ loaded: false, configured: false, items: [] });
  const [memoryStatus, setMemoryStatus] = useState<{
    loaded: boolean; configured: boolean; signedIn: boolean;
    chats: number; facts: number; skills: number; lessons: number; skillNames: string[]; lessonNames: string[];
  }>({ loaded: false, configured: false, signedIn: false, chats: 0, facts: 0, skills: 0, lessons: 0, skillNames: [], lessonNames: [] });
  const lastTapAt = useRef(0);
  const [systemChecks, setSystemChecks] = useState<{ running: boolean; results: Array<{ area: string; ok: boolean; detail: string }> }>({ running: false, results: [] });

  async function runChecks() {
    setSystemChecks({ running: true, results: [] });
    try {
      const response = await fetch("/api/system/diagnostics", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { checks?: Array<{ area: string; ok: boolean; detail: string }> } | null;
      setSystemChecks({ running: false, results: data?.checks ?? [{ area: "Diagnostics", ok: false, detail: `The check route answered ${response.status}.` }] });
    } catch (error) {
      setSystemChecks({ running: false, results: [{ area: "Diagnostics", ok: false, detail: error instanceof Error ? error.message : "The request never completed." }] });
    }
  }

  const [teach, setTeach] = useState<{ name: string; instructions: string; saving: boolean; status: { ok: boolean; message: string } | null }>({ name: "", instructions: "", saving: false, status: null });

  async function saveSkill() {
    setTeach((current) => ({ ...current, saving: true, status: null }));
    try {
      const response = await fetch("/api/memory/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teach.name.trim(), instructions: teach.instructions.trim() })
      });
      const data = (await response.json().catch(() => null)) as { error?: string; skill?: { name?: string } } | null;
      if (!response.ok || !data?.skill) {
        setTeach((current) => ({ ...current, saving: false, status: { ok: false, message: data?.error ?? `The store answered ${response.status}.` } }));
        return;
      }
      setTeach({ name: "", instructions: "", saving: false, status: { ok: true, message: `Saved “${data.skill.name}”.` } });
    } catch (error) {
      setTeach((current) => ({ ...current, saving: false, status: { ok: false, message: error instanceof Error ? error.message : "The request never completed." } }));
    }
  }

  const [micTest, setMicTest] = useState<{ running: boolean; step: string; checks: MicCheck[] }>({ running: false, step: "", checks: [] });

  async function runMicTest() {
    setMicTest({ running: true, step: "Starting", checks: [] });
    try {
      const checks = await diagnoseMicrophone((step) => setMicTest((c) => ({ ...c, step })));
      setMicTest({ running: false, step: "", checks });
    } catch (error) {
      setMicTest({ running: false, step: "", checks: [{ step: "Test", ok: false, detail: error instanceof Error ? error.message : "The test could not run." }] });
    }
  }

  const [spend, setSpend] = useState<{ configured: boolean; enabled: boolean; durable?: boolean; summary: string | null }>({ configured: false, enabled: false, summary: null });

  useEffect(() => {
    if (!open) return;
    void fetch("/api/spend", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data) setSpend(data); })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const provider = parameters.get("github") ? "GitHub" : parameters.get("google") ? "Google" : null;
    const code = parameters.get("github") ?? parameters.get("google");
    if (!provider || !code) return;
    setOauthNotice({
      connected: `${provider} connected.`,
      state: "That sign-in could not be verified.",
      denied: `${provider} sign-in was cancelled.`,
      exchange: `${provider} did not complete the sign-in. Try again.`,
      norefresh: `${provider} did not return a lasting credential.`,
      unconfigured: `${provider} is not configured.`
    }[code] ?? "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const [evalState, setEvalState] = useState<{ phase: "idle" | "running" | "done" | "error"; message: string }>({
    phase: "idle",
    message: "Scores Navi Soul against a fixed task set. Takes a couple of minutes."
  });

  const runEvals = async () => {
    haptic("impact-light", preferences.haptics);
    setEvalState({ phase: "running", message: "Running… this takes a couple of minutes, keep the app open." });
    try {
      const response = await fetch("/api/eval", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(`The run could not start (HTTP ${response.status}).`);
      const data = await response.json() as { passed: number; ran: number; total: number; errored: number; meaningful: boolean; durationMs: number; };
      if (!data.meaningful) {
        setEvalState({ phase: "error", message: `All ${data.ran} tasks failed. Check provider keys.` });
        return;
      }
      const seconds = Math.round(data.durationMs / 1000);
      setEvalState({ phase: "done", message: `${data.passed}/${data.ran} passed in ${seconds}s.` });
    } catch (error) {
      setEvalState({ phase: "error", message: error instanceof Error ? error.message : "The run did not complete." });
    }
  };

  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [account, setAccount] = useState<AccountState>({ email: "", signedIn: false, ready: false });
  const [playbookDraft, setPlaybookDraft] = useState("");
  const [playbookNotice, setPlaybookNotice] = useState<string | null>(null);
  const skillGroups = useMemo(() => categories().map((group) => ({ ...group, skills: group.skills.filter((skill: Skill) => isImplemented(skill.id)) })).filter((group) => group.skills.length), []);

  useEffect(() => {
    if (!open) return;
    const initialPage = initialSection && initialSection in PAGE_TITLES ? initialSection : "root";
    if (initialPage === "skills" || initialPage === "playbooks") {
      setPage("capabilities");
    } else {
      setPage(initialPage as PageId);
    }
  }, [initialSection, open]);

  useEffect(() => {
    if (!open || page !== "privacy") return;
    void fetch("/api/memory/facts", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean; facts?: Array<{ id: string; fact: string }> } | null) => {
        setFacts({ loaded: true, configured: data?.configured === true, items: data?.facts ?? [] });
      })
      .catch(() => setFacts((current) => ({ ...current, loaded: true })));

    void fetch("/api/memory/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean; signedIn?: boolean; chats?: number; facts?: number; skills?: number; lessons?: number; skillNames?: string[]; lessonNames?: string[] } | null) => {
        setMemoryStatus({
          loaded: true, configured: data?.configured === true, signedIn: data?.signedIn === true,
          chats: data?.chats ?? 0, facts: data?.facts ?? 0, skills: data?.skills ?? 0, lessons: data?.lessons ?? 0,
          skillNames: Array.isArray(data?.skillNames) ? data.skillNames : [], lessonNames: Array.isArray(data?.lessonNames) ? data.lessonNames : []
        });
      })
      .catch(() => setMemoryStatus((current) => ({ ...current, loaded: true })));
  }, [open, page]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receive);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receive);
  }, []);

  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!CLERK_AVAILABLE) {
      setAccount({ email: "", signedIn: false, ready: true });
      return;
    }
    const read = () => {
      const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
      if (!clerk?.loaded) return false;
      setAccount({ email: clerk.user?.primaryEmailAddress?.emailAddress ?? "", signedIn: Boolean(clerk.user), ready: true });
      return true;
    };
    if (read()) return;
    const poll = window.setInterval(() => { if (read()) window.clearInterval(poll); }, 250);
    const stop = window.setTimeout(() => { window.clearInterval(poll); setAccount((current) => ({ ...current, ready: true })); }, 5_000);
    return () => { window.clearInterval(poll); window.clearTimeout(stop); };
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<NaviPreferences>) => {
    onPreferences({ ...preferences, ...patch });
    haptic("selection", preferences.haptics);
  };
  const updateProfile = (patch: Partial<NaviPreferences["profile"]>) => {
    onPreferences({ ...preferences, profile: { ...preferences.profile, ...patch } });
  };
  const openPage = (next: PageId) => {
    if (next === "root" && page === "root") return;
    setPage(next);
    if (next !== "root" && next !== "diagnostics" && next !== "profile" && next !== "voice" && next !== "permissions") {
      update({ lastMenuSection: next as MenuSection });
    }
  };
  const updateBusy = updateStatus.phase === "checking" || updateStatus.phase === "downloading" || updateStatus.phase === "restarting";

  async function signOut() {
    const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
    try {
      await clerk?.signOut?.();
    } finally {
      window.location.href = "/sign-in";
    }
  }

  function revealDiagnostics() {
    const now = Date.now();
    const next = now - lastTapAt.current > DIAGNOSTICS_TAP_WINDOW_MS ? 1 : diagnosticsTaps + 1;
    lastTapAt.current = now;

    if (next >= DIAGNOSTICS_TAPS) {
      setDiagnosticsTaps(0);
      haptic("success", preferences.haptics);
      setPage("diagnostics");
      return;
    }
    setDiagnosticsTaps(next);
    if (next > 1) haptic("selection", preferences.haptics);
  }

  async function forget(id: string) {
    haptic("impact-light", preferences.haptics);
    const response = await fetch(`/api/memory/facts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) setFacts((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  }

  function signIn() {
    haptic("impact-light", preferences.haptics);
    window.location.href = "/sign-in";
  }

  const profileInitial = preferences.profile.displayName?.[0] || preferences.profile.fullName?.[0] || account.email?.[0]?.toUpperCase() || "S";

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#F2F2F7] dark:bg-black" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="navi-sheet-header sticky top-0 z-10 flex h-[calc(52px+var(--safe-top))] shrink-0 items-center gap-1 bg-[#F2F2F7] dark:bg-black px-2 pt-[var(--safe-top)]">
        {page === "root" ? (
          <div className="flex h-11 w-11 items-center justify-center" aria-hidden="true" />
        ) : (
          <button type="button" onClick={() => setPage("root")} aria-label="Back to Settings" className="flex h-11 w-14 items-center justify-center rounded-full text-[#0A84FF] active:opacity-60 md:hidden">
            <ChevronLeft size={30} strokeWidth={1.5} className="-ml-1" />
            <span className="text-[1.0625rem]">Back</span>
          </button>
        )}
        <div className="flex-1 text-center text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary md:pl-4 md:text-left">
          {page === "root" ? "Settings" : PAGE_TITLES[page]}
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-11 w-[72px] items-center justify-end pr-3 rounded-full text-[#0A84FF] font-semibold text-[1.0625rem] active:opacity-60">
          Done
        </button>
      </header>

      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <nav
          aria-label="Settings sections"
          className={`min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:block md:w-[264px] md:border-r md:border-[var(--border-subtle)] ${page === "root" ? "block" : "hidden"}`}
        >
          <div className="mt-2 mb-2 px-4 md:hidden">
             <h2 className="text-[2rem]/8 font-bold text-primary">Settings</h2>
          </div>

          <div className="mt-4">
            <Group>
              <button type="button" onClick={() => openPage("profile")} className="flex min-h-[76px] w-full items-center justify-between px-4 text-left active:bg-elev-3 bg-transparent transition-colors">
                 <div className="flex items-center gap-4">
                   <div className="w-[58px] h-[58px] rounded-full bg-gradient-to-b from-gray-200 to-gray-400 dark:from-gray-600 dark:to-gray-800 flex items-center justify-center text-[1.5rem] font-medium text-black dark:text-white shadow-sm border border-black/5 dark:border-white/5">
                     {profileInitial}
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[1.125rem]/6 font-normal text-primary">
                       {preferences.profile.displayName || preferences.profile.fullName || account.email || "Profile"}
                     </span>
                     <span className="text-[0.8125rem]/5 text-tertiary">Personal Info, Account</span>
                   </div>
                 </div>
                 <ChevronRight size={20} className="text-tertiary" />
              </button>
            </Group>
          </div>

          <Group>
            <RootRow label="General" active={page === "general"} onOpen={() => openPage("general")} icon={
              <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#8E8E93] text-white shrink-0"><Settings size={18} strokeWidth={2}/></span>
            } />
            <RootRow label="Connectors" onOpen={() => { onClose(); onOpenConnectors(); }} icon={
              <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#0A84FF] text-white shrink-0"><Link2 size={18} strokeWidth={2}/></span>
            } />
            <RootRow label="Capabilities" active={page === "capabilities"} onOpen={() => openPage("capabilities")} icon={
              <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF2D55] text-white shrink-0"><FlaskConical size={18} strokeWidth={2}/></span>
            } />
          </Group>

          <Group>
            <RootRow label="Memory & Storage" active={page === "privacy"} onOpen={() => openPage("privacy")} icon={
              <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#30D158] text-white shrink-0"><Shield size={18} strokeWidth={2}/></span>
            } />
          </Group>

          <button
            type="button"
            onClick={revealDiagnostics}
            className="w-full mt-4 px-4 py-6 text-center text-[0.75rem]/4 text-tertiary"
            aria-label={`NaviOS ${versionLabel()}`}
          >
            NaviOS · {versionLabel()}
            {diagnosticsTaps > 1 && diagnosticsTaps < DIAGNOSTICS_TAPS ? (
              <span className="ml-2 text-tertiary">{DIAGNOSTICS_TAPS - diagnosticsTaps} more</span>
            ) : null}
          </button>
        </nav>

        <div className={`min-h-0 w-full flex-1 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] ${page === "root" ? "hidden md:block" : "block"}`}>
          
          {page === "profile" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Account</SectionHeader>
              <Group>
                {!CLERK_AVAILABLE ? (
                  <Row label="Local workspace" description="This device only. Sign-in is not configured on this deployment." />
                ) : !account.ready ? (
                  <Row label="Account" description="Checking…" />
                ) : account.signedIn ? (
                  <Row
                    label="Signed in"
                    description={`${account.email ? `${account.email} · ` : ""}Chats and settings sync to your private cloud memory.`}
                  />
                ) : (
                  <Row
                    label="Signed out"
                    description="Chats stay on this device while signed out. Signing in lets Navi Soul answer and syncs your history to your private cloud memory."
                    control={<InlineButton onClick={signIn}>Sign in</InlineButton>}
                  />
                )}
                <div className="px-4 py-2 text-[0.8125rem]/[1.125rem] text-tertiary bg-transparent">
                  {oauthNotice || "Sign in with Google or GitHub to sync your data securely."}
                </div>
              </Group>
              
              <SectionHeader>Personal Information</SectionHeader>
              <Group>
                <Row label="Full name" control={<TextField label="Full name" value={preferences.profile.fullName} onChange={(fullName) => updateProfile({ fullName })} />} />
                <Row label="Display name" control={<TextField label="Display name" value={preferences.profile.displayName} onChange={(displayName) => updateProfile({ displayName })} />} />
                <Row label="Work" control={<BareSelect label="Work" value={preferences.profile.work} options={WORK_OPTIONS} onChange={(work) => updateProfile({ work })} />} />
              </Group>

              <SectionHeader>Instructions for Navi Soul</SectionHeader>
              <Group>
                <Row
                  label="Custom Instructions"
                  description="Navi Soul keeps these in mind across every chat on this device."
                  fullWidthControl={
                    <textarea
                      aria-label="Instructions for Navi Soul"
                      value={preferences.profile.instructions}
                      onChange={(event) => updateProfile({ instructions: event.target.value.slice(0, 4_000) })}
                      placeholder="e.g. keep explanations brief and to the point"
                      rows={4}
                      className="min-h-[112px] w-full resize-y rounded-[8px] bg-elev-3 px-3.5 py-3 text-[1rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-4"
                    />
                  }
                />
              </Group>

              {account.signedIn && (
                <div className="mt-8 px-4">
                  <button onClick={() => void signOut()} className="flex items-center justify-center gap-2 w-full h-[50px] rounded-[10px] bg-elev-2 text-[#FF453A] font-normal text-[1.0625rem] active:bg-elev-3">
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {page === "general" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Appearance</SectionHeader>
              <div className="px-4 py-4 flex gap-6 justify-center bg-transparent">
                <ThemeCard theme="light" active={preferences.theme === "light"} onClick={() => update({ theme: "light" })} label="Light" />
                <ThemeCard theme="dark" active={preferences.theme === "dark"} onClick={() => update({ theme: "dark" })} label="Dark" />
                <ThemeCard theme="system" active={preferences.theme === "system"} onClick={() => update({ theme: "system" })} label="System" />
              </div>

              <SectionHeader>Display</SectionHeader>
              <Group>
                <Row label="Chat font" control={<BareSelect label="Chat font" value={preferences.chatFont} options={[["serif", "NaviOS Serif"], ["sans", "System"]]} onChange={(value) => update({ chatFont: value === "sans" ? "sans" : "serif" })} />} />
                <Row label="Motion" control={<TextSegmented label="Motion" value={preferences.motion} options={[{ id: "full" as const, name: "System" }, { id: "reduced" as const, name: "Reduced" }]} onChange={(motion) => update({ motion })} />} />
                <Row label="Density" control={<TextSegmented label="Density" value={preferences.density} options={[{ id: "comfortable" as const, name: "Comfortable" }, { id: "compact" as const, name: "Compact" }]} onChange={(density) => update({ density })} />} />
              </Group>

              <SectionHeader>Device & App</SectionHeader>
              <Group>
                <RootRow label="Permissions" onOpen={() => setPage("permissions")} icon={
                  <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#8E8E93] text-white shrink-0"><Key size={16} strokeWidth={2.5}/></span>
                } />
                <RootRow label="Voice" onOpen={() => setPage("voice")} icon={
                  <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#0A84FF] text-white shrink-0"><Volume2 size={16} strokeWidth={2.5}/></span>
                } />
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF453A] text-white shrink-0"><Activity size={16} strokeWidth={2.5}/></span>
                    <span className="text-[1rem]/[1.375rem] text-primary">Haptic feedback</span>
                  </div>
                  <SettingsToggle label="Haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />
                </div>
              </Group>

              <SectionHeader>App Update</SectionHeader>
              <Group>
                <button type="button" onClick={() => { haptic("impact-light", preferences.haptics); setUpdateStatus({ phase: "checking", message: "Checking for the newest version…" }); requestPwaUpdate(); }} disabled={updateBusy} className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-elev-3 disabled:opacity-70 bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[1rem]/[1.375rem] text-primary">Update NaviOS</span>
                    <span className={`block text-[0.8125rem]/[1.125rem] mt-0.5 ${updateStatus.phase === "error" ? "text-danger" : "text-tertiary"}`}>{updateStatus.message}</span>
                  </span>
                  <RefreshCw size={18} className={`shrink-0 text-secondary ${updateBusy ? "animate-spin" : ""}`} />
                </button>
              </Group>
              
              <div className="mt-8 px-4">
                 <button onClick={() => { if (window.confirm("Clear all NaviOS history, projects, and settings from this device?")) { onClearData(); onClose(); } }} className="flex items-center justify-center gap-2 w-full h-[50px] rounded-[10px] bg-elev-2 text-[#FF453A] font-normal text-[1.0625rem] active:bg-elev-3">
                   Clear Local Data
                 </button>
              </div>
            </div>
          ) : null}

          {page === "permissions" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>System Permissions</SectionHeader>
              <Group>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF3B30] text-white shrink-0"><Bell size={16} strokeWidth={2.5}/></span>
                    <span className="text-[1rem]/[1.375rem] text-primary">Notifications</span>
                  </div>
                  <SettingsToggle label="Notifications" value={preferences.notifyOnComplete} onChange={() => void enableNotifications()} />
                </div>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#34C759] text-white shrink-0"><CameraIcon size={16} strokeWidth={2.5}/></span>
                    <span className="text-[1rem]/[1.375rem] text-primary">Camera</span>
                  </div>
                  <SettingsToggle label="Camera" value={true} onChange={() => haptic("warning", preferences.haptics)} />
                </div>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF9500] text-white shrink-0"><MicIcon size={16} strokeWidth={2.5}/></span>
                    <span className="text-[1rem]/[1.375rem] text-primary">Microphone</span>
                  </div>
                  <SettingsToggle label="Microphone" value={true} onChange={() => haptic("warning", preferences.haptics)} />
                </div>
              </Group>
              <p className="px-4 text-[0.8125rem] text-tertiary">
                Some permissions can only be managed from your device's primary Settings app.
              </p>
            </div>
          ) : null}

          {page === "voice" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Voice</SectionHeader>
              <Group>
                <Row label="Language" control={<BareSelect label="Voice language" value={preferences.voiceLanguage} options={VOICE_LANGUAGES} onChange={(voiceLanguage) => update({ voiceLanguage })} />} />
                <Row
                  label="Speaking rate"
                  control={
                    <span className="flex items-center gap-2">
                      <input
                        type="range"
                        min={MIN_VOICE_RATE}
                        max={MAX_VOICE_RATE}
                        step={0.05}
                        value={preferences.voiceRate}
                        onChange={(event) => update({ voiceRate: clampVoiceRate(Number(event.target.value)) })}
                        className="w-32 accent-[var(--accent)]"
                      />
                      <span className="w-10 shrink-0 text-right text-[0.8125rem]/5 font-semibold tabular-nums text-secondary">
                        {preferences.voiceRate.toFixed(2)}&times;
                      </span>
                    </span>
                  }
                />
                <Row
                  label="Test microphone"
                  description="Records two seconds and reports exactly which step fails. Speak while it listens."
                  control={
                    <InlineButton onClick={() => { haptic("selection", preferences.haptics); void runMicTest(); }}>
                      {micTest.running ? "Testing…" : "Test"}
                    </InlineButton>
                  }
                  fullWidthControl={
                    micTest.running || micTest.checks.length ? (
                      <div className="rounded-[10px] bg-elev-3 p-3">
                        {micTest.running ? (
                          <p className="text-[0.8125rem]/[1.125rem] text-secondary">{micTest.step}…</p>
                        ) : (
                          <ul className="space-y-2">
                            {micTest.checks.map((check) => (
                              <li key={check.step} className="flex gap-2">
                                <span className={`mt-[3px] shrink-0 text-[0.75rem] font-bold ${check.ok ? "text-success" : "text-danger"}`} aria-hidden="true">
                                  {check.ok ? "✓" : "✕"}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[0.8125rem]/[1.125rem] font-semibold text-primary">{check.step}</span>
                                  <span className="block break-words text-[0.75rem]/[1.125rem] text-tertiary">{check.detail}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : undefined
                  }
                />
              </Group>
            </div>
          ) : null}

          {page === "capabilities" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Tools</SectionHeader>
              <Group>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[1rem]/[1.375rem] text-primary">Web search</span>
                  <SettingsToggle label="Web search" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />
                </div>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[1rem]/[1.375rem] text-primary">Artifacts</span>
                  <SettingsToggle label="Artifacts" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />
                </div>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[1rem]/[1.375rem] text-primary">Code execution</span>
                  <SettingsToggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />
                </div>
              </Group>
              
              <SectionHeader>Teach a new skill</SectionHeader>
              <Group>
                <Row
                  label="New skill"
                  description="Stored against your account and applied in every future conversation. Type / in the composer to use it."
                  fullWidthControl={
                    <div>
                      <input
                        aria-label="Skill name"
                        value={teach.name}
                        onChange={(event) => setTeach({ ...teach, name: event.target.value.slice(0, 120), status: null })}
                        placeholder="Name, e.g. How I like commit messages"
                        className="min-h-10 w-full rounded-[8px] bg-elev-3 px-3.5 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-4"
                      />
                      <textarea
                        aria-label="Skill instructions"
                        value={teach.instructions}
                        onChange={(event) => setTeach({ ...teach, instructions: event.target.value.slice(0, 24_000), status: null })}
                        rows={3}
                        placeholder="What you want it to know or do, in your own words…"
                        className="mt-2 min-h-[100px] w-full resize-y rounded-[8px] bg-elev-3 px-3.5 py-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-4"
                      />
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => { haptic("selection", preferences.haptics); void saveSkill(); }}
                          disabled={teach.saving || !teach.name.trim() || !teach.instructions.trim()}
                          className="h-9 rounded-[8px] bg-accent px-4 text-[0.875rem]/5 font-semibold text-[var(--accent-on-primary)] active:opacity-80 disabled:opacity-50"
                        >
                          {teach.saving ? "Saving…" : "Teach it"}
                        </button>
                        {teach.status ? (
                          <span className={`min-w-0 flex-1 text-[0.8125rem] ${teach.status.ok ? "text-success" : "text-danger"}`}>
                            {teach.status.message}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  }
                />
              </Group>

              {skillGroups.map((group) => (
                <div key={group.category}>
                  <SectionHeader>{group.category}</SectionHeader>
                  <Group>
                    {group.skills.map((skill: Skill) => (
                      <div key={skill.id} className="px-4 py-3 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                        <div className="text-[1rem]/[1.375rem] text-primary">{skill.triggers.slash}</div>
                        <div className="text-[0.8125rem]/[1.125rem] text-tertiary mt-0.5">{skill.description}</div>
                      </div>
                    ))}
                  </Group>
                </div>
              ))}

              <SectionHeader>Add a Playbook</SectionHeader>
              <Group>
                <Row
                  label="Paste a SKILL.md"
                  description="Paste a SKILL.md file to give Navi Soul specific methods."
                  fullWidthControl={
                    <div>
                      <textarea
                        aria-label="Paste a SKILL.md file"
                        value={playbookDraft}
                        onChange={(event) => { setPlaybookDraft(event.target.value); setPlaybookNotice(null); }}
                        placeholder={"---\nname: my-playbook\ndescription: When Navi Soul should use this\n---\n\n# Instructions…"}
                        rows={4}
                        className="min-h-[100px] w-full resize-y rounded-[8px] bg-elev-3 px-3.5 py-3 font-mono text-[0.8125rem]/[1.125rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-4"
                      />
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const result = parseSkillMarkdown(playbookDraft);
                            if ("error" in result) { setPlaybookNotice(result.error); haptic("error", preferences.haptics); return; }
                            const next = preferences.customPlaybooks.filter((entry) => entry.id !== result.playbook.id);
                            update({ customPlaybooks: [...next, result.playbook].slice(0, 40) });
                            setPlaybookDraft("");
                            setPlaybookNotice(result.truncated ? `Added “${result.playbook.name}”, trimmed to 4,000 characters.` : `Added “${result.playbook.name}”.`);
                            haptic("success", preferences.haptics);
                          }}
                          disabled={!playbookDraft.trim()}
                          className="h-9 rounded-[8px] bg-accent px-4 text-[0.875rem]/5 font-semibold text-[var(--accent-on-primary)] active:opacity-80 disabled:opacity-50"
                        >
                          Add playbook
                        </button>
                        {playbookNotice ? (
                          <span className={`min-w-0 flex-1 text-[0.8125rem] ${playbookNotice.startsWith("Added") ? "text-success" : "text-danger"}`}>{playbookNotice}</span>
                        ) : null}
                      </div>
                    </div>
                  }
                />
              </Group>

              {preferences.customPlaybooks.length ? (
                <>
                  <SectionHeader>Your Playbooks</SectionHeader>
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
              
              <SectionHeader>Built-in Playbooks</SectionHeader>
              <Group>
                {BUILT_IN_PLAYBOOKS.map((entry) => (
                  <Row key={entry.id} label={entry.name} description={entry.description} />
                ))}
              </Group>
            </div>
          ) : null}

          {page === "privacy" ? (
            <div className="pb-10 pt-2">
              <p className="px-4 pt-4 text-[0.875rem]/[1.25rem] text-secondary">
                Conversations, projects, and preferences live in this browser. Signed in, they also sync to your own private cloud memory, readable by your account alone.
              </p>

              <SectionHeader>Memory</SectionHeader>
              <Group>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[1rem]/[1.375rem] text-primary">Local history</span>
                  <SettingsToggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />
                </div>
                <div className="flex min-h-[44px] w-full items-center justify-between px-4 bg-transparent border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[1rem]/[1.375rem] text-primary">Memory</span>
                  <SettingsToggle label="Memory" value={preferences.memory} onChange={() => update({ memory: !preferences.memory })} />
                </div>
              </Group>

              <SectionHeader>Synced to your account</SectionHeader>
              <Group>
                {!memoryStatus.loaded ? (
                  <Row label="Reading your memory…" />
                ) : !memoryStatus.configured ? (
                  <Row label="Cloud memory is off" description="Nothing leaves this device." />
                ) : !memoryStatus.signedIn ? (
                  <Row label="Signed out" description="Sign in to mirror chats, facts, and skills to your private cloud memory." />
                ) : (
                  <>
                    <Row label="Conversations" description="Restored on any device you sign in to." control={<Count value={memoryStatus.chats} />} />
                    <Row label="Facts about you" description="Listed below, and removable one by one." control={<Count value={memoryStatus.facts} />} />
                    <Row label="Skills you taught it" description="Applied in every conversation." control={<Count value={memoryStatus.skills} />} />
                    <Row label="Lessons it worked out" description="Conclusions Navi Soul drew from experience." control={<Count value={memoryStatus.lessons} />} />
                  </>
                )}
              </Group>

              <SectionHeader>Facts about you</SectionHeader>
              <Group>
                {!facts.loaded ? (
                  <Row label="Loading…" />
                ) : !facts.configured ? (
                  <Row label="Not enabled" description="Durable facts are not configured on this deployment." />
                ) : !facts.items.length ? (
                  <Row label="Nothing yet" description="Standing facts you mention are kept here so they do not have to be repeated." />
                ) : (
                  facts.items.map((item) => (
                    <Row key={item.id} label={item.fact} control={<InlineButton destructive onClick={() => void forget(item.id)}>Forget</InlineButton>} />
                  ))
                )}
              </Group>

              <SectionHeader>Your data</SectionHeader>
              <Group>
                <Row label="Export data" description="Download chats, projects, and preferences as JSON." control={<InlineButton onClick={() => { haptic("selection", preferences.haptics); onExport(); }}>Export data</InlineButton>} />
              </Group>
            </div>
          ) : null}

          {page === "diagnostics" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Check everything</SectionHeader>
              <Group>
                <Row
                  label="Run all checks"
                  description="Cloud memory, transcription, providers, and search."
                  control={<InlineButton onClick={() => { haptic("selection", preferences.haptics); void runChecks(); }}>{systemChecks.running ? "Checking…" : "Check"}</InlineButton>}
                  fullWidthControl={
                    systemChecks.results.length ? (
                      <ul className="space-y-2 rounded-[10px] bg-elev-3 p-3">
                        {systemChecks.results.map((entry) => (
                          <li key={entry.area} className="flex gap-2">
                            <span className={`mt-[3px] shrink-0 text-[0.75rem] font-bold ${entry.ok ? "text-success" : "text-danger"}`} aria-hidden="true">{entry.ok ? "✓" : "✕"}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[0.8125rem]/[1.125rem] font-semibold text-primary">{entry.area}</span>
                              <span className="block break-words text-[0.75rem]/[1.125rem] text-tertiary">{entry.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : undefined
                  }
                />
              </Group>

              <SectionHeader>Deployment variables</SectionHeader>
              <Group>
                {[
                  ["GITHUB_PAT / NAVI_GITHUB_TOKEN", "Lets Navi Soul read and commit to this app's own repository."],
                  ["GOOGLE_OAUTH_CLIENT_ID / _SECRET", "Lets each person connect their own Gmail and Calendar."],
                  ["GITHUB_OAUTH_CLIENT_ID / _SECRET", "Per-person GitHub."],
                  ["NAVI_VERCEL_TOKEN", "Deployment and build-log reads."],
                  ["MCP_SERVER_REGISTRY_JSON", "The connector servers this deployment offers."],
                  ["HF_TOKEN", "Voice transcription, image and audio generation."]
                ].map(([name, detail]) => (
                  <Row key={name} label={name} description={detail} />
                ))}
              </Group>

              <SectionHeader>Routing</SectionHeader>
              <Group>
                <Row
                  label="Pin an engine"
                  description="Navi Soul reads each request and routes it to whichever engine leads at that job."
                  control={
                    <BareSelect
                      label="Pin an engine"
                      value={preferences.routeOverride ?? "navi-soul"}
                      options={DIAGNOSTIC_ROUTES.map((route) => [route.id, route.label] as [string, string])}
                      onChange={(value) => update({ routeOverride: value === "navi-soul" ? undefined : value as NaviPreferences["routeOverride"] })}
                    />
                  }
                />
                {preferences.routeOverride ? (
                  <Row label="Routing is pinned" description="Automatic routing is off. Answers will not improve until this is cleared." control={<InlineButton destructive onClick={() => update({ routeOverride: undefined })}>Clear</InlineButton>} />
                ) : null}
              </Group>

              <SectionHeader>Measurement</SectionHeader>
              <Group>
                <button type="button" onClick={() => void runEvals()} disabled={evalState.phase === "running"} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-elev-3 disabled:opacity-70 bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[1rem]/[1.375rem] text-primary">Run quality check</span>
                    <span className={`block text-[0.8125rem]/[1.125rem] mt-0.5 ${evalState.phase === "error" ? "text-danger" : "text-tertiary"}`}>{evalState.message}</span>
                  </span>
                  <FlaskConical size={18} className={`shrink-0 text-secondary ${evalState.phase === "running" ? "animate-pulse" : ""}`} />
                </button>
              </Group>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
