"use client";

import {
  ChevronLeft,
  ChevronRight,
  Monitor,
  Moon,
  FlaskConical,
  RefreshCw,
  Sun,
  X,
  Check,
  Link2,
  Shield,
  Mic,
  Activity
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences } from "@/lib/ai/types";
import { clampVoiceRate, MAX_VOICE_RATE, MIN_VOICE_RATE } from "@/lib/ui/speech";
import { categories, isImplemented, type Skill } from "@/lib/skills";
import { BUILT_IN_PLAYBOOKS, parseSkillMarkdown } from "@/lib/playbooks";
import { DIAGNOSTIC_ROUTES } from "@/lib/chat";
import {
  PWA_UPDATE_STATUS_EVENT,
  requestPwaUpdate,
  type PwaUpdateStatus
} from "@/lib/pwa-update";
import type { StorageDurability } from "@/lib/storage/indexeddb";
import { haptic } from "@/lib/ui/haptics";
import { diagnoseMicrophone, type MicCheck } from "@/lib/ui/recorder";
import { versionLabel } from "@/lib/version";
import { releaseOverlaysForNavigation } from "@/lib/ui/overlay-route";

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

type PageId = "root" | "diagnostics" | "voice" | MenuSection;

const DIAGNOSTICS_TAPS = 5;
const DIAGNOSTICS_TAP_WINDOW_MS = 3_000;

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
  diagnostics: "Diagnostics",
  general: "General",
  account: "Account",
  privacy: "Memory and storage",
  capabilities: "Capabilities",
  connectors: "Connectors",
  skills: "Skills",
  playbooks: "Playbooks",
  voice: "Voice",
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
  return <h3 className="mb-1 mt-10 px-4 text-[0.9375rem]/5 font-semibold text-primary first:mt-4">{children}</h3>;
}

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

function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--border-subtle)]">{children}</div>;
}

function Count({ value }: { value: number }) {
  return <span className="text-[0.9375rem]/[1.375rem] tabular-nums text-secondary">{value}</span>;
}

export function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-[120ms] ${value ? "bg-success" : "bg-elev-3"}`}
    >
      <span className={`absolute top-[3px] h-5 w-5 rounded-full shadow-sm transition-transform duration-[140ms] ${value ? "translate-x-[21px] bg-white" : "translate-x-[3px] bg-white"}`} />
    </button>
  );
}

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

function RootRow({ label, active, onOpen }: { label: string; active?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[52px] w-full items-center justify-between px-4 text-left active:bg-elev-2 ${active ? "md:bg-elev-2" : ""}`}
    >
      <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary">{label}</span>
      <ChevronRight size={18} className="text-tertiary md:hidden" />
    </button>
  );
}

function ThemeCard({ theme, active, onClick, label }: { theme: "light" | "dark" | "system", active: boolean, onClick: () => void, label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-3 flex-1 active:scale-95 transition-transform">
      <div className={`w-full aspect-[4/5] rounded-[18px] border-[3px] flex flex-col p-2.5 transition-colors ${active ? "border-accent bg-elev-1" : "border-transparent bg-elev-2"}`}>
         {theme === "light" ? (
            <div className="w-full h-full bg-[#FAF9F5] rounded-xl p-2 space-y-2 shadow-sm border border-black/5 overflow-hidden">
               <div className="w-1/2 h-2.5 bg-gray-200 rounded-full" />
               <div className="w-full h-7 bg-white rounded-lg shadow-sm flex items-center px-2"><div className="w-2.5 h-2.5 bg-blue-500 rounded-full"/></div>
               <div className="w-11/12 h-7 bg-white rounded-lg shadow-sm flex items-center px-2 self-end justify-end"><div className="w-2.5 h-2.5 bg-green-500 rounded-full"/></div>
            </div>
         ) : theme === "dark" ? (
            <div className="w-full h-full bg-[#121214] rounded-xl p-2 space-y-2 shadow-sm border border-white/5 overflow-hidden">
               <div className="w-1/2 h-2.5 bg-gray-700 rounded-full" />
               <div className="w-full h-7 bg-[#27272A] rounded-lg shadow-sm flex items-center px-2"><div className="w-2.5 h-2.5 bg-blue-400 rounded-full"/></div>
               <div className="w-11/12 h-7 bg-[#27272A] rounded-lg shadow-sm flex items-center px-2 self-end justify-end"><div className="w-2.5 h-2.5 bg-green-400 rounded-full"/></div>
            </div>
         ) : (
            <div className="w-full h-full rounded-xl shadow-sm border border-black/5 dark:border-white/5 relative overflow-hidden flex">
               <div className="w-1/2 h-full bg-[#FAF9F5] p-2 space-y-2">
                  <div className="w-full h-2.5 bg-gray-200 rounded-full" />
                  <div className="w-full h-7 bg-white rounded-lg flex items-center px-1.5"><div className="w-2 h-2 bg-blue-500 rounded-full"/></div>
               </div>
               <div className="w-1/2 h-full bg-[#121214] p-2 space-y-2 flex flex-col items-end">
                  <div className="w-full h-2.5 bg-gray-700 rounded-full" />
                  <div className="w-full h-7 bg-[#27272A] rounded-lg flex items-center px-1.5 justify-end"><div className="w-2 h-2 bg-green-400 rounded-full"/></div>
               </div>
            </div>
         )}
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${active ? "border-accent bg-accent text-[var(--accent-on-primary)]" : "border-tertiary"}`}>
          {active && <Check size={10} strokeWidth={3} />}
        </div>
        <span className={`text-[0.875rem]/4 font-medium ${active ? "text-primary" : "text-tertiary"}`}>{label}</span>
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
  const [facts, setFacts] = useState<{ loaded: boolean; configured: boolean; items: Array<{ id: string; fact: string }> }>(
    { loaded: false, configured: false, items: [] }
  );
  const [memoryStatus, setMemoryStatus] = useState<{
    loaded: boolean; configured: boolean; signedIn: boolean;
    chats: number; facts: number; skills: number; lessons: number; skillNames: string[]; lessonNames: string[];
  }>({ loaded: false, configured: false, signedIn: false, chats: 0, facts: 0, skills: 0, lessons: 0, skillNames: [], lessonNames: [] });
  const lastTapAt = useRef(0);
  const [systemChecks, setSystemChecks] = useState<{ running: boolean; results: Array<{ area: string; ok: boolean; detail: string }> }>(
    { running: false, results: [] }
  );

  async function runChecks() {
    setSystemChecks({ running: true, results: [] });
    try {
      const response = await fetch("/api/system/diagnostics", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { checks?: Array<{ area: string; ok: boolean; detail: string }> } | null;
      setSystemChecks({
        running: false,
        results: data?.checks ?? [{ area: "Diagnostics", ok: false, detail: `The check route answered ${response.status}.` }]
      });
    } catch (error) {
      setSystemChecks({
        running: false,
        results: [{ area: "Diagnostics", ok: false, detail: error instanceof Error ? error.message : "The request never completed." }]
      });
    }
  }

  const [teach, setTeach] = useState<{ name: string; instructions: string; saving: boolean; status: { ok: boolean; message: string } | null }>(
    { name: "", instructions: "", saving: false, status: null }
  );

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
        setTeach((current) => ({
          ...current,
          saving: false,
          status: { ok: false, message: data?.error ?? `The store answered ${response.status}.` }
        }));
        return;
      }
      setTeach({ name: "", instructions: "", saving: false, status: { ok: true, message: `Saved “${data.skill.name}”. It applies from the next message.` } });
    } catch (error) {
      setTeach((current) => ({
        ...current,
        saving: false,
        status: { ok: false, message: error instanceof Error ? error.message : "The request never completed." }
      }));
    }
  }

  const [micTest, setMicTest] = useState<{ running: boolean; step: string; checks: MicCheck[] }>(
    { running: false, step: "", checks: [] }
  );

  async function runMicTest() {
    setMicTest({ running: true, step: "Starting", checks: [] });
    try {
      const checks = await diagnoseMicrophone((step) => setMicTest((c) => ({ ...c, step })));
      setMicTest({ running: false, step: "", checks });
    } catch (error) {
      setMicTest({
        running: false,
        step: "",
        checks: [{ step: "Test", ok: false, detail: error instanceof Error ? error.message : "The test could not run." }]
      });
    }
  }

  const [spend, setSpend] = useState<{ configured: boolean; enabled: boolean; durable?: boolean; summary: string | null }>(
    { configured: false, enabled: false, summary: null }
  );

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
      state: "That sign-in could not be verified. Start it again from Connectors.",
      denied: `${provider} sign-in was cancelled.`,
      exchange: `${provider} did not complete the sign-in. Try again.`,
      norefresh: `${provider} did not return a lasting credential. Remove NaviOS from your Google account's third-party access, then connect again.`,
      unconfigured: `${provider} is not configured on this deployment.`
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
      const data = await response.json() as {
        passed: number; ran: number; total: number; errored: number; meaningful: boolean; durationMs: number;
      };
      if (!data.meaningful) {
        setEvalState({ phase: "error", message: `All ${data.ran} tasks failed to reach a model. Check that provider keys are configured.` });
        return;
      }
      const seconds = Math.round(data.durationMs / 1000);
      const errorNote = data.errored ? ` · ${data.errored} errored` : "";
      setEvalState({ phase: "done", message: `${data.passed}/${data.ran} passed in ${seconds}s${errorNote}.` });
    } catch (error) {
      setEvalState({ phase: "error", message: error instanceof Error ? error.message : "The run did not complete." });
    }
  };

  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [account, setAccount] = useState<AccountState>({ email: "", signedIn: false, ready: false });
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
    setPage(initialSection && initialSection in PAGE_TITLES ? initialSection : "root");
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
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receive);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receive);
  }, []);

  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );
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
      setAccount({
        email: clerk.user?.primaryEmailAddress?.emailAddress ?? "",
        signedIn: Boolean(clerk.user),
        ready: true
      });
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

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-app" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="navi-sheet-header sticky top-0 z-10 flex h-[calc(52px+var(--safe-top))] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 pt-[var(--safe-top)]">
        {page === "root" ? (
          <div className="flex h-11 w-11 items-center justify-center" aria-hidden="true" />
        ) : (
          <button type="button" onClick={() => setPage("root")} aria-label="Back to Settings" className="flex h-11 w-11 items-center justify-center rounded-full text-primary active:bg-elev-2 md:hidden">
            <ChevronLeft size={22} strokeWidth={1.8} />
          </button>
        )}
        <div className="flex-1 text-center text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary md:pl-4 md:text-left">
          {page === "root" ? "Settings" : PAGE_TITLES[page]}
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-11 w-11 items-center justify-center rounded-full text-primary active:bg-elev-2">
          <X size={20} strokeWidth={1.8} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <nav
          aria-label="Settings sections"
          className={`min-h-0 shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:block md:w-[264px] md:border-r md:border-[var(--border-subtle)] ${page === "root" ? "w-full" : "hidden"}`}
        >
          <p className="mt-4 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Settings</p>
          <Group>
            <RootRow label="General" active={page === "general"} onOpen={() => openPage("general")} />
            <RootRow label="Account" active={page === "account"} onOpen={() => openPage("account")} />
            <RootRow label="Memory and storage" active={page === "privacy"} onOpen={() => openPage("privacy")} />
            <RootRow label="Capabilities" active={page === "capabilities"} onOpen={() => openPage("capabilities")} />
          </Group>
          <p className="mt-8 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Customize</p>
          <Group>
            <RootRow label="Skills" active={page === "skills"} onOpen={() => openPage("skills")} />
            <RootRow label="Playbooks" active={page === "playbooks"} onOpen={() => openPage("playbooks")} />
            <RootRow label="Connectors" onOpen={() => openPage("connectors")} />
          </Group>
          <button
            type="button"
            onClick={revealDiagnostics}
            className="w-full px-4 py-6 text-left text-[0.75rem]/4 text-tertiary"
            aria-label={`NaviOS ${versionLabel()}`}
          >
            NaviOS · {versionLabel()}
            {diagnosticsTaps > 1 && diagnosticsTaps < DIAGNOSTICS_TAPS ? (
              <span className="ml-2 text-tertiary">{DIAGNOSTICS_TAPS - diagnosticsTaps} more</span>
            ) : null}
          </button>
        </nav>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] ${page === "root" ? "hidden md:block" : ""}`}>
          {page === "root" ? (
            <p className="px-6 pt-8 text-[0.8125rem]/[1.25rem] text-tertiary">Choose a section.</p>
          ) : null}

        {page === "general" ? (
          <div className="pb-10">
            <SectionHeader>Appearance</SectionHeader>
            <div className="px-4 py-3 flex gap-3">
              <ThemeCard theme="light" active={preferences.theme === "light"} onClick={() => update({ theme: "light" })} label="Light" />
              <ThemeCard theme="dark" active={preferences.theme === "dark"} onClick={() => update({ theme: "dark" })} label="Dark" />
              <ThemeCard theme="system" active={preferences.theme === "system"} onClick={() => update({ theme: "system" })} label="System" />
            </div>

            <SectionHeader>Device & App</SectionHeader>
            <Group>
              <button type="button" onClick={() => openPage("connectors")} className="flex min-h-[50px] w-full items-center px-4 active:bg-elev-2 transition-colors">
                <div className="flex items-center gap-3 w-full">
                  <span className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-[#0A84FF] text-white shrink-0"><Link2 size={16} /></span>
                  <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary flex-1 text-left">Connectors</span>
                  <ChevronRight size={18} className="text-tertiary" />
                </div>
              </button>
              <button type="button" onClick={() => haptic("selection", preferences.haptics)} className="flex min-h-[50px] w-full items-center px-4 active:bg-elev-2 transition-colors">
                <div className="flex items-center gap-3 w-full">
                  <span className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-[#30D158] text-white shrink-0"><Shield size={16} /></span>
                  <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary flex-1 text-left">Permissions</span>
                  <ChevronRight size={18} className="text-tertiary" />
                </div>
              </button>
              <button type="button" onClick={() => setPage("voice")} className="flex min-h-[50px] w-full items-center px-4 active:bg-elev-2 transition-colors">
                <div className="flex items-center gap-3 w-full">
                  <span className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-[#FF9F0A] text-white shrink-0"><Mic size={16} /></span>
                  <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary flex-1 text-left">Voice</span>
                  <ChevronRight size={18} className="text-tertiary" />
                </div>
              </button>
              <div className="flex min-h-[50px] w-full items-center px-4">
                <div className="flex items-center gap-3 w-full">
                  <span className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-[#FF453A] text-white shrink-0"><Activity size={16} /></span>
                  <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary flex-1 text-left">Haptic feedback</span>
                  <SettingsToggle label="Haptics" value={preferences.haptics} onChange={() => update({ haptics: !preferences.haptics })} />
                </div>
              </div>
            </Group>

            <SectionHeader>Display</SectionHeader>
            <Group>
              <Row
                label="Chat font"
                control={
                  <BareSelect
                    label="Chat font"
                    value={preferences.chatFont}
                    options={[["serif", "NaviOS Serif"], ["sans", "System"]]}
                    onChange={(value) => update({ chatFont: value === "sans" ? "sans" : "serif" })}
                  />
                }
              />
              <Row
                label="Motion"
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
            </Group>

            <SectionHeader>Profile</SectionHeader>
            <Group>
              <Row label="Full name" control={<TextField label="Full name" value={preferences.profile.fullName} onChange={(fullName) => updateProfile({ fullName })} />} />
              <Row label="What should Navi Soul call you?" control={<TextField label="Display name" value={preferences.profile.displayName} onChange={(displayName) => updateProfile({ displayName })} />} />
              <Row label="What best describes your work?" control={<BareSelect label="Work" value={preferences.profile.work} options={WORK_OPTIONS} onChange={(work) => updateProfile({ work })} />} />
              <Row
                label="Instructions for Navi Soul"
                description="Navi Soul keeps these in mind across every chat on this device."
                fullWidthControl={
                  <textarea
                    aria-label="Instructions for Navi Soul"
                    value={preferences.profile.instructions}
                    onChange={(event) => updateProfile({ instructions: event.target.value.slice(0, 4_000) })}
                    placeholder="e.g. keep explanations brief and to the point"
                    rows={4}
                    className="min-h-[112px] w-full resize-y rounded-[12px] bg-elev-2 px-3.5 py-3 text-[0.9375rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
                  />
                }
              />
            </Group>
          </div>
        ) : null}

        {page === "voice" ? (
          <>
            <SectionHeader>Voice</SectionHeader>
            <Group>
              <Row
                label="Language"
                control={
                  <BareSelect
                    label="Voice language"
                    value={preferences.voiceLanguage}
                    options={VOICE_LANGUAGES}
                    onChange={(voiceLanguage) => update({ voiceLanguage })}
                  />
                }
              />
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
                      aria-label="Speaking rate"
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
                    <div className="rounded-[12px] bg-elev-2 p-3">
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
          </>
        ) : null}

        {page === "account" ? (
          <>
            <SectionHeader>Account</SectionHeader>
            <Group>
              {!CLERK_AVAILABLE ? (
                <Row
                  label="Local workspace"
                  description="This device only. Sign-in is not configured on this deployment."
                />
              ) : !account.ready ? (
                <Row label="Account" description="Checking…" />
              ) : account.signedIn ? (
                <Row
                  label="Signed in"
                  description={`${account.email ? `${account.email} · ` : ""}Chats and settings sync to your private cloud memory.`}
                  control={<InlineButton onClick={() => void signOut()}>Log out</InlineButton>}
                />
              ) : (
                <Row
                  label="Signed out"
                  description="Chats stay on this device while signed out. Signing in lets Navi Soul answer and syncs your history to your private cloud memory."
                  control={<InlineButton onClick={signIn}>Sign in</InlineButton>}
                />
              )}
              {spend.configured ? (
                <Row
                  label="Monthly usage"
                  description={spend.enabled
                    ? `${spend.summary}${spend.durable === false ? " · counted on this server only" : ""}`
                    : "The quality lane is off. Its spending limit cannot be enforced without a shared store, so it stays off until one is configured."}
                />
              ) : null}
            </Group>

            <SectionHeader>App</SectionHeader>
            <Group>
              <button type="button" onClick={() => { haptic("impact-light", preferences.haptics); setUpdateStatus({ phase: "checking", message: "Checking for the newest version…" }); requestPwaUpdate(); }} disabled={updateBusy} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-elev-2 disabled:opacity-70">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem]/[1.375rem] font-medium text-primary">Update NaviOS</span>
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
                control={<InlineButton destructive onClick={() => { if (window.confirm("Clear all NaviOS history, projects, and settings from this device?")) { onClearData(); onClose(); } }}>Clear</InlineButton>}
              />
            </Group>
          </>
        ) : null}

        {page === "privacy" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              Conversations, projects, and preferences live in this browser. Signed in, they also sync to your own
              private cloud memory, readable by your account alone.
            </p>

            <SectionHeader>Memory</SectionHeader>
            <Group>
              <Row
                label="Local history"
                description={DURABILITY_DETAIL[durability]}
                control={<SettingsToggle label="Local history" value={preferences.saveHistory} onChange={() => update({ saveHistory: !preferences.saveHistory })} />}
              />
              <Row
                label="Memory"
                description="Let a new chat draw on relevant passages from your earlier ones. Matching happens on this device; only the passages Navi Soul actually uses are sent."
                control={<SettingsToggle label="Memory" value={preferences.memory} onChange={() => update({ memory: !preferences.memory })} />}
              />
            </Group>

            <SectionHeader>On this device</SectionHeader>
            <Group>
              <Row
                label="Conversations"
                description="Held in this browser. These are the chats in your drawer."
                control={<Count value={localChatCount} />}
              />
            </Group>

            <SectionHeader>Synced to your account</SectionHeader>
            <Group>
              {!memoryStatus.loaded ? (
                <Row label="Reading your memory…" />
              ) : !memoryStatus.configured ? (
                <Row
                  label="Cloud memory is off"
                  description="Nothing leaves this device. Your conversations above are safe here; they are simply not mirrored anywhere, so they do not follow you to another device."
                />
              ) : !memoryStatus.signedIn ? (
                <Row
                  label="Signed out"
                  description="Nothing is syncing. Your conversations above stay on this device. Sign in to mirror chats, facts, and skills to your private cloud memory."
                />
              ) : (
                <>
                  <Row label="Conversations" description="Restored on any device you sign in to." control={<Count value={memoryStatus.chats} />} />
                  <Row label="Facts about you" description="Listed below, and removable one by one." control={<Count value={memoryStatus.facts} />} />
                  <Row label="Skills you taught it" description="Applied in every conversation, not only when a request happens to match." control={<Count value={memoryStatus.skills} />} />
                  <Row label="Lessons it worked out" description="Conclusions Navi Soul drew from experience and carries forward on its own." control={<Count value={memoryStatus.lessons} />} />
                </>
              )}
            </Group>

            <p className="px-4 pt-4 text-[0.75rem]/[1.125rem] text-tertiary">Facts about you</p>
            <Group>
              {!facts.loaded ? (
                <Row label="Loading…" />
              ) : !facts.configured ? (
                <Row
                  label="Not enabled"
                  description="Durable facts are not configured on this deployment, so nothing is remembered between conversations. Recall within this device still works."
                />
              ) : !facts.items.length ? (
                <Row
                  label="Nothing yet"
                  description="Standing facts you mention — how you work, what you use, what you always want — are kept here so they do not have to be repeated. Passing details of a request are not."
                />
              ) : (
                facts.items.map((item) => (
                  <Row
                    key={item.id}
                    label={item.fact}
                    control={<InlineButton destructive onClick={() => void forget(item.id)}>Forget</InlineButton>}
                  />
                ))
              )}
            </Group>
            {facts.configured && facts.items.length ? (
              <p className="px-4 pt-2 text-[0.75rem]/[1.125rem] text-tertiary">
                Forgetting is immediate and cannot be undone. The Memory switch above stops anything new being added.
              </p>
            ) : null}

            {memoryStatus.skillNames.length ? (
              <>
                <p className="px-4 pt-4 text-[0.75rem]/[1.125rem] text-tertiary">Skills you taught it</p>
                <Group>
                  {memoryStatus.skillNames.map((name) => <Row key={name} label={name} />)}
                </Group>
              </>
            ) : null}
            {memoryStatus.lessonNames.length ? (
              <>
                <p className="px-4 pt-4 text-[0.75rem]/[1.125rem] text-tertiary">Lessons it worked out</p>
                <Group>
                  {memoryStatus.lessonNames.map((name) => <Row key={name} label={name} />)}
                </Group>
              </>
            ) : null}

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
            <SectionHeader>What Navi Soul can do</SectionHeader>
            <Group>
              <Row
                label="Web search"
                description="Search the web and read pages when a request needs live information."
                control={<SettingsToggle label="Web search" value={preferences.tools.web} onChange={() => update({ tools: { ...preferences.tools, web: !preferences.tools.web } })} />}
              />
              <Row
                label="Artifacts"
                description="Build interactive documents and designs in a window alongside the conversation."
                control={<SettingsToggle label="Artifacts" value={preferences.tools.artifacts} onChange={() => update({ tools: { ...preferences.tools, artifacts: !preferences.tools.artifacts } })} />}
              />
              <Row
                label="Code execution"
                description="Run JavaScript on this device to check its own work before answering, then fix what fails. Nothing it runs can reach the network or your files."
                control={<SettingsToggle label="Code execution" value={preferences.tools.code} onChange={() => update({ tools: { ...preferences.tools, code: !preferences.tools.code } })} />}
              />
            </Group>
            <SectionHeader>Accounts</SectionHeader>
            <Group>
              <RootRow label="Connectors" onOpen={() => openPage("connectors")} />
            </Group>
            <p className="px-4 pt-2 text-[0.75rem]/[1.125rem] text-tertiary">
              {oauthNotice || "Google, GitHub, Vercel, and any connector servers this deployment offers."}
            </p>

          </>
        ) : null}

        {page === "diagnostics" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              For proving a suspicion about the app, not for using it. Nothing here improves an
              answer, and the routing override makes answers worse by design — it exists so a
              single engine can be blamed or cleared.
            </p>

            <SectionHeader>Check everything</SectionHeader>
            <Group>
              <Row
                label="Run all checks"
                description="Cloud memory, transcription, this app's repository, providers, and search. Each one performs a real request."
                control={
                  <InlineButton onClick={() => { haptic("selection", preferences.haptics); void runChecks(); }}>
                    {systemChecks.running ? "Checking…" : "Check"}
                  </InlineButton>
                }
                fullWidthControl={
                  systemChecks.results.length ? (
                    <ul className="space-y-2 rounded-[12px] bg-elev-2 p-3">
                      {systemChecks.results.map((entry) => (
                        <li key={entry.area} className="flex gap-2">
                          <span className={`mt-[3px] shrink-0 text-[0.75rem] font-bold ${entry.ok ? "text-success" : "text-danger"}`} aria-hidden="true">
                            {entry.ok ? "✓" : "✕"}
                          </span>
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
            <p className="px-4 text-[0.8125rem]/[1.25rem] text-tertiary">
              Set in the hosting project&apos;s environment, then redeploy. They apply to everyone using this
              deployment. Ask Navi Soul &ldquo;what is broken?&rdquo; to have it check which of these are actually working.
            </p>
            <Group>
              {[
                ["GITHUB_PAT / NAVI_GITHUB_TOKEN", "Lets Navi Soul read and commit to this app's own repository in Code mode. Without it, self-editing is off."],
                ["NAVI_SELF_UPDATE_BRANCH", "Which branch self-edits commit to. Defaults to main."],
                ["GOOGLE_OAUTH_CLIENT_ID / _SECRET", "Lets each person connect their own Gmail and Calendar."],
                ["GITHUB_OAUTH_CLIENT_ID / _SECRET", "Per-person GitHub. Must be a separate OAuth app from the one Clerk uses for sign-in — one app holds one callback URL."],
                ["NAVI_VERCEL_TOKEN", "Deployment and build-log reads, for the whole deployment rather than per person."],
                ["MCP_SERVER_REGISTRY_JSON", "The connector servers this deployment offers."],
                ["HF_TOKEN", "Voice transcription, image and audio generation. Needs the “Make calls to Inference Providers” permission."]
              ].map(([name, detail]) => (
                <Row key={name} label={name} description={detail} />
              ))}
            </Group>

            <SectionHeader>Routing</SectionHeader>
            <Group>
              <Row
                label="Pin an engine"
                description="Navi Soul reads each request and routes it to whichever engine leads at that job. Pinning one disables that routing entirely, for every request, until it is set back to automatic."
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
                <Row
                  label="Routing is pinned"
                  description="Automatic routing is off. Answers will not improve until this is cleared."
                  control={<InlineButton destructive onClick={() => update({ routeOverride: undefined })}>Clear</InlineButton>}
                />
              ) : null}
            </Group>

            <SectionHeader>Measurement</SectionHeader>
            <Group>
              <button
                type="button"
                onClick={() => void runEvals()}
                disabled={evalState.phase === "running"}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-elev-2 disabled:opacity-70"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem]/[1.375rem] font-medium text-primary">Run quality check</span>
                  <span className={`block text-[0.8125rem]/[1.125rem] ${evalState.phase === "error" ? "text-danger" : "text-secondary"}`}>
                    {evalState.message}
                  </span>
                </span>
                <FlaskConical size={18} className={`shrink-0 text-secondary ${evalState.phase === "running" ? "animate-pulse" : ""}`} />
              </button>
            </Group>

            <SectionHeader>Build</SectionHeader>
            <Group>
              <Row label="Version" description={versionLabel()} />
              <Row
                label="Sign-in"
                description={CLERK_AVAILABLE
                  ? "Configured on this deployment."
                  : "Not configured on this deployment. The deployment logs name what is absent."}
              />
              <Row label="Local storage" description={DURABILITY_DETAIL[durability]} />
            </Group>
          </>
        ) : null}

        {page === "playbooks" ? (
          <>
            <p className="px-4 pt-5 text-[0.8125rem]/[1.25rem] text-secondary">
              Playbooks are methods Navi Soul applies when a request matches one — how to debug, how to review code,
              how to edit a document without disturbing it. They use the SKILL.md format — YAML frontmatter with a
              name and description, then markdown instructions — so a skill file written for any tool that uses it
              can be pasted in below. Only the instructions are read: a long file is trimmed to the first 4,000
              characters, and bundled scripts or reference files do not come across.
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
                      placeholder={"---\nname: my-playbook\ndescription: When Navi Soul should use this\n---\n\n# Instructions…"}
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
                          setPlaybookNotice(result.truncated
                            ? `Added “${result.playbook.name}”, trimmed to the first 4,000 characters.`
                            : `Added “${result.playbook.name}”.`);
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
              Many also work from ordinary words: “format this json:”, “sha256 of…”, “sort lines:”.
            </p>

            <SectionHeader>Teach Navi Soul something</SectionHeader>
            <Group>
              <Row
                label="New skill"
                description="Stored against your account and applied in every future conversation."
                fullWidthControl={
                  <div>
                    <input
                      aria-label="Skill name"
                      value={teach.name}
                      onChange={(event) => setTeach({ ...teach, name: event.target.value.slice(0, 120), status: null })}
                      placeholder="Name, e.g. How I like commit messages"
                      className="min-h-12 w-full rounded-[12px] bg-elev-2 px-3.5 text-[0.9375rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
                    />
                    <textarea
                      aria-label="Skill instructions"
                      value={teach.instructions}
                      onChange={(event) => setTeach({ ...teach, instructions: event.target.value.slice(0, 24_000), status: null })}
                      rows={5}
                      placeholder="What you want it to know or do, in your own words…"
                      className="mt-2 min-h-[132px] w-full resize-y rounded-[12px] bg-elev-2 px-3.5 py-3 text-[0.9375rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => { haptic("selection", preferences.haptics); void saveSkill(); }}
                        disabled={teach.saving || !teach.name.trim() || !teach.instructions.trim()}
                        className="h-9 rounded-full bg-accent px-4 text-[0.8125rem]/5 font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed disabled:opacity-50"
                      >
                        {teach.saving ? "Saving…" : "Teach it"}
                      </button>
                      {teach.status ? (
                        <span className={`min-w-0 flex-1 text-[0.75rem]/4 ${teach.status.ok ? "text-success" : "text-danger"}`}>
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
                    <div key={skill.id} className="px-4 py-3">
                      <div className="text-[0.9375rem]/[1.375rem] font-medium text-primary">{skill.triggers.slash}</div>
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
    </div>
  );
}
