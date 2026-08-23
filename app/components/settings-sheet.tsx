"use client";

import {
  Activity,
  Bell,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Key,
  Link2,
  LogOut,
  Mic,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  Smartphone,
  Sun,
  Volume2,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences } from "@/lib/ai/types";
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
  privacy: "Memory & Storage",
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
  return <h3 className="mb-1.5 mt-8 px-4 text-[13px] font-normal text-[#6E6E73] dark:text-[#EBEBF599] uppercase tracking-wide">{children}</h3>;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-6 rounded-[10px] bg-white dark:bg-[#1C1C1E]">{children}</div>;
}

function Row({ label, description, control, fullWidthControl }: {
  label: string;
  description?: ReactNode;
  control?: ReactNode;
  fullWidthControl?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col justify-center min-h-[44px] px-4 py-2.5 bg-transparent">
      <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6] last-of-type:hidden" />
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[17px] tracking-[-0.41px] text-primary">{label}</span>
        {control}
      </div>
      {description ? <p className="mt-1 text-[13px] text-tertiary">{description}</p> : null}
      {fullWidthControl ? <div className="mt-2">{fullWidthControl}</div> : null}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-[17px] tracking-[-0.41px] text-secondary">{value}</span>;
}

export function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-[200ms] ${value ? "bg-[#0A84FF]" : "bg-[#E5E5EA] dark:bg-[#39393D]"}`}
    >
      <span className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-sm transition-transform duration-[200ms] ${value ? "translate-x-[20px]" : "translate-x-0"}`} />
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
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-[8px] bg-elev-3 dark:bg-[#3A3A3C] p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-[28px] rounded-[6px] px-3 text-[13px] font-medium transition-colors duration-[100ms] ${value ? "bg-white dark:bg-[#636366] text-primary shadow-sm" : "text-primary"}`}
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
    <span className="relative flex shrink-0 items-center gap-1.5 text-[17px] tracking-[-0.41px] text-secondary">
      {current}
      <ChevronRight size={20} className="text-[#3C3C434A] dark:text-[#EBEBF54A]" />
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
      className="h-10 w-[55%] min-w-0 shrink-0 text-right text-[17px] tracking-[-0.41px] text-secondary outline-none bg-transparent placeholder:text-tertiary"
    />
  );
}

function InlineButton({ children, onClick, destructive }: { children: ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] w-full shrink-0 px-4 text-left text-[17px] tracking-[-0.41px] active:bg-black/5 dark:active:bg-white/5 ${destructive ? "text-[#FF453A]" : "text-[#0A84FF]"}`}
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
      className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5 bg-transparent"
    >
      <div className="absolute bottom-0 left-[60px] right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6] last-of-type:hidden" />
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-[17px] tracking-[-0.41px] text-primary">{label}</span>
      </div>
      <ChevronRight size={20} className="text-[#3C3C434A] dark:text-[#EBEBF54A]" />
    </button>
  );
}

function ThemeCard({ theme, active, onClick, label }: { theme: "light" | "dark" | "system", active: boolean, onClick: () => void, label: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-center gap-2 p-2 active:scale-95 transition-all bg-transparent`}>
      <div className={`w-[54px] h-[72px] rounded-[10px] overflow-hidden flex flex-col p-1.5 border-[2px] ${active ? "border-[#0A84FF]" : "border-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"}`}>
         {theme === "light" && <div className="w-full h-full bg-[#FFFFFF] rounded-md shadow-sm" />}
         {theme === "dark" && <div className="w-full h-full bg-[#1C1C1E] rounded-md shadow-sm" />}
         {theme === "system" && (
            <div className="w-full h-full rounded-md shadow-sm flex overflow-hidden">
              <div className="w-1/2 h-full bg-[#FFFFFF]" />
              <div className="w-1/2 h-full bg-[#1C1C1E]" />
            </div>
         )}
      </div>
      <div className="flex flex-col items-center gap-1 mt-1">
        <span className={`text-[13px] ${active ? "font-medium text-primary" : "text-tertiary"}`}>{label}</span>
        <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${active ? "border-[#0A84FF] bg-[#0A84FF] text-white" : "border-[#C7C7CC] dark:border-[#38383A]"}`}>
          {active && <Check size={12} strokeWidth={3} />}
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

  async function enableNotifications() {
    if (preferences.notifyOnComplete) {
      update({ notifyOnComplete: false });
      return;
    }
    if (!("Notification" in window)) return;
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") update({ notifyOnComplete: true });
  }

  const profileInitial = preferences.profile.displayName?.[0] || preferences.profile.fullName?.[0] || account.email?.[0]?.toUpperCase() || "S";

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#F2F2F7] dark:bg-black" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="navi-sheet-header sticky top-0 z-10 flex min-h-[44px] pt-[max(var(--safe-top),env(safe-area-inset-top))] pb-2 shrink-0 items-center justify-between bg-[#F2F2F7] dark:bg-black px-2 border-b border-[var(--border-subtle)]">
        <div className="flex w-24 items-center justify-start">
          {page === "root" ? (
            <div className="h-11 w-11 items-center justify-center" aria-hidden="true" />
          ) : (
            <button type="button" onClick={() => setPage("root")} aria-label="Back to Settings" className="flex h-11 items-center justify-center text-[#0A84FF] active:opacity-60 md:hidden">
              <ChevronLeft size={32} strokeWidth={1.5} className="-ml-1" />
              <span className="text-[17px] font-normal tracking-[-0.41px] -ml-1">Back</span>
            </button>
          )}
        </div>
        <div className="flex-1 text-center text-[17px] font-semibold tracking-[-0.41px] text-primary md:pl-4 md:text-left truncate">
          {page === "root" ? "Settings" : PAGE_TITLES[page]}
        </div>
        <div className="flex w-24 items-center justify-end">
          <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-11 items-center justify-end pr-3 text-[#0A84FF] font-semibold text-[17px] tracking-[-0.41px] active:opacity-60">
            Done
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <nav
          aria-label="Settings sections"
          className={`min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:block md:w-[264px] md:border-r md:border-[var(--border-subtle)] ${page === "root" ? "block" : "hidden"}`}
        >
          <div className="mt-2 mb-2 px-4 md:hidden">
             <h2 className="text-[34px] tracking-[0.37px] font-bold text-primary">Settings</h2>
          </div>

          <div className="mt-4">
            <Group>
              <button type="button" onClick={() => openPage("profile")} className="flex min-h-[76px] w-full items-center justify-between px-4 text-left active:bg-black/5 dark:active:bg-white/5 bg-transparent transition-colors">
                 <div className="flex items-center gap-4">
                   <div className="w-[60px] h-[60px] rounded-full bg-gradient-to-b from-gray-200 to-gray-400 dark:from-gray-600 dark:to-gray-800 flex items-center justify-center text-[22px] font-medium text-black dark:text-white shadow-sm border border-black/5 dark:border-white/5">
                     {profileInitial}
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[20px] font-normal tracking-tight text-primary">
                       {preferences.profile.displayName || preferences.profile.fullName || account.email || "Profile"}
                     </span>
                     <span className="text-[13px] text-tertiary">Apple Account, iCloud, and more</span>
                   </div>
                 </div>
                 <ChevronRight size={20} className="text-[#3C3C434A] dark:text-[#EBEBF54A]" />
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
            className="w-full mt-4 px-4 py-6 text-center text-[13px] font-normal text-tertiary"
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
                  />
                )}
                <div className="px-4 py-2 text-[13px] text-tertiary bg-transparent">
                  {oauthNotice || "Sign in with Google or GitHub to sync your data securely."}
                </div>
              </Group>

              {!account.signedIn && CLERK_AVAILABLE && (
                <Group>
                   <InlineButton onClick={signIn}>Sign in</InlineButton>
                </Group>
              )}
              
              <SectionHeader>Personal Information</SectionHeader>
              <Group>
                <Row label="Full name" control={<TextField label="Full name" value={preferences.profile.fullName} onChange={(fullName) => updateProfile({ fullName })} />} />
                <Row label="Display name" control={<TextField label="Display name" value={preferences.profile.displayName} onChange={(displayName) => updateProfile({ displayName })} />} />
                <Row label="Work" control={<BareSelect label="Work" value={preferences.profile.work} options={WORK_OPTIONS} onChange={(work) => updateProfile({ work })} />} />
              </Group>

              <SectionHeader>Instructions for Navi Soul</SectionHeader>
              <Group>
                <div className="px-4 py-2 bg-transparent">
                  <textarea
                    aria-label="Instructions for Navi Soul"
                    value={preferences.profile.instructions}
                    onChange={(event) => updateProfile({ instructions: event.target.value.slice(0, 4_000) })}
                    placeholder="e.g. keep explanations brief and to the point"
                    rows={4}
                    className="min-h-[112px] w-full resize-y bg-transparent text-[17px] tracking-[-0.41px] text-primary outline-none placeholder:text-tertiary"
                  />
                </div>
              </Group>

              {account.signedIn && (
                <Group>
                  <InlineButton destructive onClick={() => void signOut()}>Log out</InlineButton>
                </Group>
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
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF453A] text-white shrink-0"><Activity size={16} strokeWidth={2.5}/></span>
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Haptic feedback</span>
                  </div>
                  <SettingsToggle label="Haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />
                </div>
              </Group>

              <SectionHeader>App Update</SectionHeader>
              <Group>
                <button type="button" onClick={() => { haptic("impact-light", preferences.haptics); setUpdateStatus({ phase: "checking", message: "Checking for the newest version…" }); requestPwaUpdate(); }} disabled={updateBusy} className="flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5 bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] tracking-[-0.41px] text-primary">Update NaviOS</span>
                    <span className={`block text-[13px] mt-0.5 ${updateStatus.phase === "error" ? "text-[#FF453A]" : "text-tertiary"}`}>{updateStatus.message}</span>
                  </span>
                  <RefreshCw size={18} className={`shrink-0 text-[#3C3C434A] dark:text-[#EBEBF54A] ${updateBusy ? "animate-spin" : ""}`} />
                </button>
              </Group>
              
              <Group>
                 <InlineButton destructive onClick={() => { if (window.confirm("Clear all NaviOS history, projects, and settings from this device?")) { onClearData(); onClose(); } }}>
                   Clear Local Data
                 </InlineButton>
              </Group>
            </div>
          ) : null}

          {page === "permissions" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>System Permissions</SectionHeader>
              <Group>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="absolute bottom-0 left-[60px] right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6]" />
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF3B30] text-white shrink-0"><Bell size={16} strokeWidth={2.5}/></span>
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Notifications</span>
                  </div>
                  <SettingsToggle label="Notifications" value={preferences.notifyOnComplete} onChange={() => void enableNotifications()} />
                </div>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="absolute bottom-0 left-[60px] right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6]" />
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#34C759] text-white shrink-0"><Camera size={16} strokeWidth={2.5}/></span>
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Camera</span>
                  </div>
                  <SettingsToggle label="Camera" value={true} onChange={() => haptic("warning", preferences.haptics)} />
                </div>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-[#FF9500] text-white shrink-0"><Mic size={16} strokeWidth={2.5}/></span>
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Microphone</span>
                  </div>
                  <SettingsToggle label="Microphone" value={true} onChange={() => haptic("warning", preferences.haptics)} />
                </div>
              </Group>
              <p className="px-4 text-[13px] text-tertiary">
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
                      <span className="w-10 shrink-0 text-right text-[17px] tracking-[-0.41px] font-semibold tabular-nums text-secondary">
                        {preferences.voiceRate.toFixed(2)}&times;
                      </span>
                    </span>
                  }
                />
              </Group>
              <Group>
                <InlineButton onClick={() => { haptic("selection", preferences.haptics); void runMicTest(); }}>
                   {micTest.running ? "Testing Microphone…" : "Test Microphone"}
                </InlineButton>
              </Group>
              {micTest.running || micTest.checks.length ? (
                <div className="px-4 pb-6">
                  <div className="rounded-[10px] bg-white dark:bg-[#1C1C1E] p-4">
                    {micTest.running ? (
                      <p className="text-[17px] tracking-[-0.41px] text-secondary">{micTest.step}…</p>
                    ) : (
                      <ul className="space-y-3">
                        {micTest.checks.map((check) => (
                          <li key={check.step} className="flex gap-3">
                            <span className={`mt-0.5 shrink-0 text-[15px] font-bold ${check.ok ? "text-[#34C759]" : "text-[#FF453A]"}`} aria-hidden="true">
                              {check.ok ? "✓" : "✕"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[17px] tracking-[-0.41px] font-medium text-primary">{check.step}</span>
                              <span className="block text-[13px] text-tertiary mt-0.5">{check.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {page === "capabilities" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Tools</SectionHeader>
              <Group>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6]" />
                  <span className="text-[17px] tracking-[-0.41px] text-primary">Web search</span>
                  <SettingsToggle label="Web search" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />
                </div>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6]" />
                  <span className="text-[17px] tracking-[-0.41px] text-primary">Artifacts</span>
                  <SettingsToggle label="Artifacts" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />
                </div>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <span className="text-[17px] tracking-[-0.41px] text-primary">Code execution</span>
                  <SettingsToggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />
                </div>
              </Group>
              
              <SectionHeader>Teach a new skill</SectionHeader>
              <Group>
                <div className="px-4 py-3 bg-transparent border-b border-[#3C3C434A] dark:border-[#545458A6]">
                  <input
                    aria-label="Skill name"
                    value={teach.name}
                    onChange={(event) => setTeach({ ...teach, name: event.target.value.slice(0, 120), status: null })}
                    placeholder="Name, e.g. How I like commit messages"
                    className="h-10 w-full bg-transparent text-[17px] tracking-[-0.41px] text-primary outline-none placeholder:text-tertiary"
                  />
                </div>
                <div className="px-4 py-3 bg-transparent">
                  <textarea
                    aria-label="Skill instructions"
                    value={teach.instructions}
                    onChange={(event) => setTeach({ ...teach, instructions: event.target.value.slice(0, 24_000), status: null })}
                    rows={4}
                    placeholder="What you want it to know or do, in your own words…"
                    className="w-full resize-y bg-transparent text-[17px] tracking-[-0.41px] text-primary outline-none placeholder:text-tertiary"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { haptic("selection", preferences.haptics); void saveSkill(); }}
                      disabled={teach.saving || !teach.name.trim() || !teach.instructions.trim()}
                      className="h-11 rounded-[10px] bg-[#0A84FF] px-4 text-[17px] tracking-[-0.41px] font-semibold text-white active:opacity-80 disabled:opacity-50"
                    >
                      {teach.saving ? "Saving…" : "Teach it"}
                    </button>
                    {teach.status ? (
                      <span className={`min-w-0 flex-1 text-[13px] ${teach.status.ok ? "text-[#34C759]" : "text-[#FF453A]"}`}>
                        {teach.status.message}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Group>

              {(memoryStatus.skillNames.length > 0 || memoryStatus.lessonNames.length > 0) && (
                /* What it has actually learned, shown rather than only counted.
                   Both lists were already being fetched every time this sheet
                   opened and neither was rendered — so the app knew what it had
                   been taught and had no way to say it. Kept apart because they
                   are different things: one the owner taught it on purpose, the
                   other it drew from its own work. */
                <>
                  <SectionHeader>What Navi Soul has learned</SectionHeader>
                  <Group>
                    {memoryStatus.skillNames.length > 0 && (
                      <Row label={`Taught by you · ${memoryStatus.skillNames.length}`} description={memoryStatus.skillNames.join(" · ")} />
                    )}
                    {memoryStatus.lessonNames.length > 0 && (
                      <Row label={`Learned from its own work · ${memoryStatus.lessonNames.length}`} description={memoryStatus.lessonNames.join(" · ")} />
                    )}
                  </Group>
                </>
              )}

              {skillGroups.map((group) => (
                <div key={group.category}>
                  <SectionHeader>{group.category}</SectionHeader>
                  <Group>
                    {group.skills.map((skill: Skill) => (
                      <div key={skill.id} className="relative px-4 py-3 bg-transparent">
                        <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6] last-of-type:hidden" />
                        <div className="text-[17px] tracking-[-0.41px] text-primary">{skill.triggers.slash}</div>
                        <div className="text-[13px] text-tertiary mt-0.5">{skill.description}</div>
                      </div>
                    ))}
                  </Group>
                </div>
              ))}

              <SectionHeader>Add a Playbook</SectionHeader>
              <Group>
                <div className="px-4 py-3 bg-transparent">
                  <textarea
                    aria-label="Paste a SKILL.md file"
                    value={playbookDraft}
                    onChange={(event) => { setPlaybookDraft(event.target.value); setPlaybookNotice(null); }}
                    placeholder={"---\nname: my-playbook\ndescription: When Navi Soul should use this\n---\n\n# Instructions…"}
                    rows={4}
                    className="w-full resize-y bg-transparent font-mono text-[13px] text-primary outline-none placeholder:text-tertiary"
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
                      className="h-11 rounded-[10px] bg-[#0A84FF] px-4 text-[17px] tracking-[-0.41px] font-semibold text-white active:opacity-80 disabled:opacity-50"
                    >
                      Add playbook
                    </button>
                    {playbookNotice ? (
                      <span className={`min-w-0 flex-1 text-[13px] ${playbookNotice.startsWith("Added") ? "text-[#34C759]" : "text-[#FF453A]"}`}>{playbookNotice}</span>
                    ) : null}
                  </div>
                </div>
              </Group>

              {preferences.customPlaybooks.length ? (
                <>
                  <SectionHeader>Your Playbooks</SectionHeader>
                  <Group>
                    {preferences.customPlaybooks.map((entry) => (
                      <div key={entry.id} className="relative flex flex-col justify-center min-h-[44px] px-4 py-2.5 bg-transparent">
                        <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6] last-of-type:hidden" />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[17px] tracking-[-0.41px] text-primary truncate">{entry.name}</span>
                          <button type="button" onClick={() => update({ customPlaybooks: preferences.customPlaybooks.filter((item) => item.id !== entry.id) })} className="text-[17px] tracking-[-0.41px] text-[#FF453A] active:opacity-60">
                            Remove
                          </button>
                        </div>
                        {entry.description && <p className="mt-1 text-[13px] text-tertiary">{entry.description}</p>}
                      </div>
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
              <p className="px-4 mb-2 mt-2 text-[13px] text-tertiary">
                Conversations, projects, and preferences live in this browser. Signed in, they also sync to your own private cloud memory.
              </p>

              <SectionHeader>Memory</SectionHeader>
              <Group>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6]" />
                  <div className="flex flex-col flex-1 min-w-0 pr-4">
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Local history</span>
                    <span className="text-[13px] text-tertiary mt-0.5">{DURABILITY_DETAIL[durability]}</span>
                  </div>
                  <SettingsToggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />
                </div>
                <div className="relative flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 bg-transparent">
                  <div className="flex flex-col flex-1 min-w-0 pr-4">
                    <span className="text-[17px] tracking-[-0.41px] text-primary">Memory</span>
                    <span className="text-[13px] text-tertiary mt-0.5">Let a new chat draw on relevant passages from your earlier ones.</span>
                  </div>
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
                    <div key={item.id} className="relative flex flex-col justify-center min-h-[44px] px-4 py-2.5 bg-transparent">
                      <div className="absolute bottom-0 left-4 right-0 h-[1px] bg-[#3C3C434A] dark:bg-[#545458A6] last-of-type:hidden" />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[17px] tracking-[-0.41px] text-primary">{item.fact}</span>
                        <button type="button" onClick={() => void forget(item.id)} className="text-[17px] tracking-[-0.41px] text-[#FF453A] active:opacity-60">
                          Forget
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </Group>

              <SectionHeader>Your data</SectionHeader>
              <Group>
                <InlineButton onClick={() => { haptic("selection", preferences.haptics); onExport(); }}>Export data</InlineButton>
              </Group>
            </div>
          ) : null}

          {page === "diagnostics" ? (
            <div className="pb-10 pt-2">
              <SectionHeader>Check everything</SectionHeader>
              <Group>
                <InlineButton onClick={() => { haptic("selection", preferences.haptics); void runChecks(); }}>{systemChecks.running ? "Checking…" : "Run all checks"}</InlineButton>
                {systemChecks.results.length ? (
                  <div className="px-4 py-3 border-t border-[#3C3C434A] dark:border-[#545458A6]">
                    <ul className="space-y-3">
                      {systemChecks.results.map((entry) => (
                        <li key={entry.area} className="flex gap-3">
                          <span className={`mt-0.5 shrink-0 text-[15px] font-bold ${entry.ok ? "text-[#34C759]" : "text-[#FF453A]"}`} aria-hidden="true">{entry.ok ? "✓" : "✕"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[17px] tracking-[-0.41px] font-medium text-primary">{entry.area}</span>
                            <span className="block break-words text-[13px] text-tertiary mt-0.5">{entry.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Group>

              <SectionHeader>Deployment variables</SectionHeader>
              <Group>
                {[
                  ["GITHUB_PAT / NAVI_GITHUB_TOKEN", "Lets Navi Soul read and commit to this app's own repository."],
                  /* Read from the constant rather than restated. This row said
                     "Defaults to main" after the default became a branch behind
                     a pull request — telling the owner their self-edits go live
                     when they now wait for CI and a merge. */
                  [`NAVI_SELF_UPDATE_BRANCH`, `Which branch self-edits commit to. Defaults to ${DEFAULT_SELF_UPDATE_BRANCH}, which opens a pull request rather than going live.`],
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
                  <InlineButton destructive onClick={() => update({ routeOverride: undefined })}>Clear Pin</InlineButton>
                ) : null}
              </Group>

              <SectionHeader>Measurement</SectionHeader>
              <Group>
                <button type="button" onClick={() => void runEvals()} disabled={evalState.phase === "running"} className="flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5 bg-transparent disabled:opacity-70">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] tracking-[-0.41px] text-primary">Run quality check</span>
                    <span className={`block text-[13px] mt-0.5 ${evalState.phase === "error" ? "text-[#FF453A]" : "text-tertiary"}`}>{evalState.message}</span>
                  </span>
                  <FlaskConical size={20} className={`shrink-0 text-[#3C3C434A] dark:text-[#EBEBF54A] ${evalState.phase === "running" ? "animate-pulse" : ""}`} />
                </button>
              </Group>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
