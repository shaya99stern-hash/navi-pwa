"use client";

import {
  ChevronLeft,
  ChevronRight,
  Monitor,
  Moon,
  FlaskConical,
  RefreshCw,
  Sun,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuSection, NaviPreferences } from "@/lib/ai/types";
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
  /* Conversations held in IndexedDB on this device — the same list the drawer
     renders. The "What is stored" screen counted only the cloud mirror, so a
     signed-out user, or any deployment without Supabase, read `Conversations 0`
     while five of them sat visible in the drawer beside it. The number was
     accurate about the cloud and wrong about the question being asked, on a
     privacy screen, which is the worst place to be technically correct. */
  localChatCount: number;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
  onOpenConnectors: () => void;
  onClearData: () => void;
  onExport: () => void;
};

/**
 * `diagnostics` is deliberately not a `MenuSection`.
 *
 * `MenuSection` is what gets persisted as `lastMenuSection` and reopened next
 * time. A hidden page that reopens itself is not hidden, and it would strand
 * anyone who found it by accident on a screen with no row leading to it.
 */
type PageId = "root" | "diagnostics" | MenuSection;

/** Taps on the version string that reveal diagnostics, and how long they have. */
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
};

const DURABILITY_DETAIL: Record<StorageDurability, string> = {
  persisted: "Stored on this device and protected from automatic cleanup",
  "best-effort": "Stored on this device · the browser may clear it if space runs low",
  unavailable: "Stored on this device · export regularly, this browser cannot protect it"
};

/**
 * Whether this build has a sign-in system at all.
 *
 * Computed in next.config.mjs and inlined at build time, so it is the one thing
 * the client can know without waiting for Clerk's script — and so it stays true
 * when the deployment names its keys differently. Reading the publishable key
 * directly here missed both the server-side alias and the case where a key is
 * present but nothing can verify a session with it.
 *
 * A deployment without sign-in has no account to offer and should say so,
 * rather than showing a button leading to a page reading "sign-in is
 * unavailable".
 */
const CLERK_AVAILABLE = process.env.NEXT_PUBLIC_NAVI_AUTH === "on";

type ClerkGlobal = {
  loaded?: boolean;
  user?: { primaryEmailAddress?: { emailAddress?: string } } | null;
  signOut?: () => Promise<void>;
};

type AccountState = { email: string; signedIn: boolean; ready: boolean };

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

/** A number in the control slot. Tabular so a column of them stays aligned. */
function Count({ value }: { value: number }) {
  return <span className="text-[0.9375rem]/[1.375rem] tabular-nums text-secondary">{value}</span>;
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

function RootRow({ label, active, onOpen }: { label: string; active?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      /* The selected state only means something beside the pane it selects, so
         it is a two-pane affordance. The chevron is the opposite: it promises a
         drill-down, which at two panes is not what happens. */
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[52px] w-full items-center justify-between px-4 text-left active:bg-elev-2 ${active ? "md:bg-elev-2" : ""}`}
    >
      <span className="text-[0.9375rem]/[1.375rem] font-medium text-primary">{label}</span>
      <ChevronRight size={18} className="text-tertiary md:hidden" />
    </button>
  );
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
  /* The OAuth callback returns here with a reason in the query string. Each one
     gets a sentence — a raw code on screen is not an explanation. The rows
     themselves live in the Connectors sheet now; this is only the landing. */
  const [oauthNotice, setOauthNotice] = useState("");
  const [diagnosticsTaps, setDiagnosticsTaps] = useState(0);
  /* What is remembered about this person, and the ability to forget it. Loaded
     only on the Privacy page: it is a network read, and every other page would
     be paying for it. */
  const [facts, setFacts] = useState<{ loaded: boolean; configured: boolean; items: Array<{ id: string; fact: string }> }>(
    { loaded: false, configured: false, items: [] }
  );
  /* What is actually in durable memory, counted from the store. Loaded on the
     Privacy page only, for the same reason facts are: it is a network read. */
  const [memoryStatus, setMemoryStatus] = useState<{
    loaded: boolean; configured: boolean; signedIn: boolean;
    chats: number; facts: number; skills: number; lessons: number; skillNames: string[]; lessonNames: string[];
  }>({ loaded: false, configured: false, signedIn: false, chats: 0, facts: 0, skills: 0, lessons: 0, skillNames: [], lessonNames: [] });
  const lastTapAt = useRef(0);
  /* The microphone self-test. Three rounds of "the mic doesn't work" were
     diagnosed by reading source, and two of those guesses were wrong — so the
     app now answers the question itself instead of being guessed at. */
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

  /* Monthly spend on the one metered lane. Read here and nowhere else: it
     belongs on the account page, not in the middle of an answer. */
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
      /* Distinct from a failed exchange: Google withholds the refresh token when
         the account has authorized before and the consent screen was skipped.
         The connection would look successful and stop working within the hour. */
      norefresh: `${provider} did not return a lasting credential. Remove NaviOS from your Google account's third-party access, then connect again.`,
      unconfigured: `${provider} is not configured on this deployment.`
    }[code] ?? "");
    /* Clear it from the URL so a reload does not replay the notice. */
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
      /* A run where every task errored scores zero and means nothing — the
         requests never reached a model. Reporting "0/12" for that would be a
         lie about quality rather than a report about configuration. */
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
    /* A section that no longer exists opens the list, not a blank pane.
       `lastMenuSection` is persisted, so a device that last had Developer open
       would otherwise reopen Settings onto nothing at all. */
    setPage(initialSection && initialSection in PAGE_TITLES ? initialSection : "root");
  }, [initialSection, open]);

  useEffect(() => {
    if (!open || page !== "privacy") return;
    void fetch("/api/memory/facts", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean; facts?: Array<{ id: string; fact: string }> } | null) => {
        setFacts({ loaded: true, configured: data?.configured === true, items: data?.facts ?? [] });
      })
      /* Unreachable storage is not "nothing remembered" — saying so would
         invite someone to conclude the feature is off when it is merely down. */
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

  /* Clerk exposes the signed-in user on `window`, but it loads asynchronously
     and this sheet can open first. Reading once left the row saying "Local
     workspace" on a deployment that had an account perfectly well — the state
     that prompted "why is there no sign in or sign out here". So poll briefly
     until Clerk reports itself loaded, then stop.

     Hooks are not an option: ClerkProvider only wraps the tree when the
     deployment is configured, so `useUser` would throw on the deployments this
     row most needs to describe. */
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
    /* Give up rather than spin forever: a Clerk that has not loaded in five
       seconds is not going to, and the row says so instead of staying blank. */
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
    /* Developer is a route rather than a pane: it is a working surface with
       its own editor and commit state, which a sheet that closes on a stray
       swipe is the wrong container for. */
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

  /**
   * Five taps on the version string, within a few seconds of each other.
   *
   * The window is what makes it a gesture rather than a trap: without it, four
   * stray taps across a whole session would leave the page one tap from
   * opening, months later, for someone who never intended it.
   */
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
    /* Only drop it from the list once the server confirms. Removing optimistically
       would show a fact as forgotten while it was still stored, which is the one
       lie a privacy control must not tell. */
    if (response?.ok) setFacts((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  }

  function signIn() {
    haptic("impact-light", preferences.haptics);
    /* A full navigation, not a router push: the sign-in page lives outside the
       app shell and comes back through a redirect that has to re-establish the
       session cookie. */
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
        {/* At two panes the list is always on screen, so a back button points
            at a page that is not hidden — it reads as an extra step to nowhere. */}
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

      {/* One list, two arrangements. Under 768px it is a drill-down: the list
          fills the sheet and a section replaces it. At 768px and up both are on
          screen at once, because there is room and because moving between
          sections is the common act — a drill-down on a wide screen spends a
          full-width column on nothing and makes every move a round trip. */}
      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <nav
          aria-label="Settings sections"
          className={`min-h-0 shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:block md:w-[264px] md:border-r md:border-[var(--border-subtle)] ${page === "root" ? "w-full" : "hidden"}`}
        >
          <p className="mt-4 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Settings</p>
          <Group>
            <RootRow label="General" active={page === "general"} onOpen={() => openPage("general")} />
            <RootRow label="Account" active={page === "account"} onOpen={() => openPage("account")} />
            {/* Named for what people look for. "Storage and memory" lives on
                the Privacy page, and someone hunting for their memory does not
                think of it as a privacy question — so the row says so. */}
            <RootRow label="Memory and storage" active={page === "privacy"} onOpen={() => openPage("privacy")} />
            <RootRow label="Capabilities" active={page === "capabilities"} onOpen={() => openPage("capabilities")} />
          </Group>
          <p className="mt-8 px-4 text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Customize</p>
          <Group>
            <RootRow label="Skills" active={page === "skills"} onOpen={() => openPage("skills")} />
            <RootRow label="Playbooks" active={page === "playbooks"} onOpen={() => openPage("playbooks")} />
            <RootRow label="Connectors" onOpen={() => openPage("connectors")} />
          </Group>
          {/* Diagnostics live behind this. They are for proving a suspicion
              about the app, not for using it, and a routing override left on
              by someone exploring Settings silently disables the routing the
              product depends on. */}
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
          {/* Wide and nothing chosen yet: the pane says what it is for rather
              than sitting blank, and choosing is one click away in the list. */}
          {page === "root" ? (
            <p className="px-6 pt-8 text-[0.8125rem]/[1.25rem] text-tertiary">Choose a section.</p>
          ) : null}

        {page === "general" ? (
          <>
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
                    options={[["serif", "NaviOS Serif"], ["sans", "System"]]}
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
                /* What it used to say — "on selection, success, and errors" —
                   described two thirds of a thing that could not happen. A
                   haptic needs transient user activation, and success and
                   error are by definition known after a round trip, by which
                   time the activation the tap granted has expired. Those ticks
                   were refused every time, so the same gesture buzzed or did
                   not depending on whether its outcome happened to be
                   synchronous. Feedback now fires on the touch, which is the
                   only moment the platform will honour, and outcomes are
                   reported where an outcome belongs: on screen. */
                description="A light tick when a touch is registered — a button, a switch, a sheet opening or closing. Results are shown on screen rather than felt."
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
                    /* The mirror into `navi.voice.language.v1` is gone with the
                       private copy it fed. Voice mode reads this preference
                       directly now, so there is one language and no write that
                       has to remember to keep a second one in step. */
                    onChange={(voiceLanguage) => update({ voiceLanguage })}
                  />
                }
              />
              {/* Runs the real pipeline — permission, capture, measured signal,
                  encoding, and the network round trip — and names the first
                  step that fails. "It doesn't work" describes six different
                  failures; this says which one. */}
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

            <SectionHeader>Notifications</SectionHeader>
            <Group>
              <Row
                label="Response completions"
                description="Get notified when Navi Soul has finished a response. Useful for long-running tasks."
                control={<SettingsToggle label="Response completions" value={preferences.notifyOnComplete} onChange={() => void enableNotifications()} />}
              />
            </Group>
          </>
        ) : null}

        {page === "account" ? (
          <>
            <SectionHeader>Account</SectionHeader>
            <Group>
              {/* Three states, and the row used to render only one of them.
                  Without a sign-in control the app looked like it had no
                  account system at all — which is true of exactly one of
                  these three cases. */}
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
              {/* Only shown when there is actually something to spend. An app
                  that is entirely free has no business displaying a budget. */}
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
            {/* One subject, read top to bottom: the switches that govern
                memory, then everything memory currently holds.

                It used to be four sections in a different order — a paragraph,
                the facts list, the switches, then counts that referred to
                "the list above" across an intervening section, with the
                storage-durability sentence printed twice. Every part worked;
                the page was just assembled in the order the features were
                built rather than the order anyone reads them. */}
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

            {/* Counted, not promised. "Saved" with nothing to check it against
                is exactly the claim that stopped being believable — so this
                reads the store and shows what is in it, by name. */}
            {/* Two questions, asked and answered separately, because they have
                different answers and merging them is what made this screen
                lie. "What is on this phone" is always answerable and is what
                the drawer beside it shows. "What has reached my account" is
                answerable only when a store is configured and someone is
                signed in — and when it is not, the honest answer is a sentence
                about sync, never a zero next to the word Conversations. */}
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
                  {/* Separate from the count above on purpose. These are
                      conclusions Navi Soul drew on its own, so seeing them
                      counted — and named below — is the only way to notice one
                      that is wrong before it quietly shapes every answer. */}
                  <Row label="Lessons it worked out" description="Conclusions Navi Soul drew from experience and carries forward on its own." control={<Count value={memoryStatus.lessons} />} />
                </>
              )}
            </Group>

            {/* Directly under the count it belongs to, rather than a section
                away from it. */}
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
            {/* Three switches, one group.
                They used to sit under four headings — "General", "Visuals",
                "Code execution and file creation", "Accounts" — one row each,
                with the third heading repeating its own row's label word for
                word. Four headings to organise three switches is not
                organisation; it is the taxonomy costing more than the thing
                being classified, on a screen whose title already says what all
                three are. */}
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
            {/* Connecting an account happens in one place. This screen used to
                carry its own GitHub and Vercel rows while the sheet called
                Connectors listed only MCP servers, so a connected account was
                invisible from the screen named after connecting things — and
                an empty registry read as "nothing is connected" while two
                accounts were. */}
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

            {/* What the Developer screen was actually for.
                That screen was a path box, a textarea and a commit button — a
                text editor on a phone, and a worse one than simply telling
                Navi Soul in Code mode to make the change, which reads the file
                and commits it itself. The editor is gone. What could not go is
                this: the deployment variables are real and someone has to be
                able to look them up. They live here, with the other things
                that exist to answer "why is it behaving like that". */}
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
              {/* A pin is the one setting here with a lasting cost, and it is
                  invisible from every other screen once this page is closed. */}
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
              {/* The eval harness needed a terminal, so in practice the app's
                  own quality was never measured. Same task set, same grading,
                  run by the deployment against itself — from the phone. */}
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
              {/* This used to promise that any published skill "works here
                  unchanged". Measured against 35 real published SKILL.md
                  files: all 35 parsed, but 22 had their instructions cut at
                  4,000 characters — one kept only a fifth of its body — and
                  the ones that ship companion scripts or reference files
                  cannot bring them, because a playbook is prompt text and
                  nothing else. "Unchanged" was true for a third of them.
                  The sentence now says what the parser actually does, and
                  truncation is reported at paste time rather than silently. */}
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
                          /* Said out loud, because the alternative is a
                             playbook that stops mid-sentence during a real
                             request and no way to know why. */
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
            </p>
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
