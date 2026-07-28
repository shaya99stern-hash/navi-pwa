"use client";

import { Download, RefreshCw, Share, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PWA_UPDATE_STATUS_EVENT,
  requestPwaUpdate,
  type PwaUpdateStatus
} from "@/lib/pwa-update";

const INSTALL_DISMISS_KEY = "navi.pwa.install-dismissed.v1";
const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1_000;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type BadgeNavigator = Navigator & {
  clearAppBadge?: () => Promise<void>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function isIosDevice(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function recentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const value = Number(localStorage.getItem(INSTALL_DISMISS_KEY) ?? 0);
  return Number.isFinite(value) && Date.now() - value < INSTALL_DISMISS_MS;
}

export function PwaPlatformBanner() {
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissedUpdate, setDismissedUpdate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const receiveStatus = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (!detail?.phase || !detail.message) return;
      setUpdateStatus(detail);
      if (detail.phase === "available") setDismissedUpdate(false);
    };

    const captureInstall = (event: Event) => {
      event.preventDefault();
      if (recentlyDismissed()) return;
      setInstallPrompt(event as InstallPromptEvent);
      setIosHint(false);
    };

    const installed = () => {
      setInstallPrompt(null);
      setIosHint(false);
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    };

    const clearBadge = () => {
      const badgeNavigator = navigator as BadgeNavigator;
      void badgeNavigator.clearAppBadge?.().catch(() => undefined);
    };

    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receiveStatus);
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", installed);
    document.addEventListener("visibilitychange", clearBadge);
    clearBadge();

    const hintTimer = window.setTimeout(() => {
      if (!isStandalone() && isIosDevice() && !recentlyDismissed()) setIosHint(true);
    }, 1_800);

    return () => {
      window.clearTimeout(hintTimer);
      window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receiveStatus);
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", installed);
      document.removeEventListener("visibilitychange", clearBadge);
    };
  }, []);

  const mode = useMemo<"update" | "install" | "ios" | null>(() => {
    if (!mounted) return null;
    if (updateStatus?.phase === "available" && !dismissedUpdate) return "update";
    if (!isStandalone() && installPrompt && !recentlyDismissed()) return "install";
    if (!isStandalone() && iosHint) return "ios";
    return null;
  }, [dismissedUpdate, installPrompt, iosHint, mounted, updateStatus?.phase]);

  if (!mode) return null;

  async function install() {
    if (!installPrompt || installing) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPrompt(null);
        setIosHint(false);
      } else {
        localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
        setInstallPrompt(null);
      }
    } finally {
      setInstalling(false);
    }
  }

  function dismissInstall() {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setInstallPrompt(null);
    setIosHint(false);
  }

  return (
    <aside className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+88px)] z-[80] mx-auto max-w-[560px] rounded-[22px] border border-[var(--border-strong)] bg-elev-1 p-3 shadow-sheet" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent">
          {mode === "update" ? <RefreshCw size={20} /> : mode === "ios" ? <Share size={20} /> : <Smartphone size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px]/5 font-semibold text-primary">
            {mode === "update" ? "Navi update ready" : mode === "ios" ? "Install Navi on iPhone" : "Install Navi"}
          </span>
          <span className="mt-0.5 block text-[11px]/4 font-medium text-tertiary">
            {mode === "update"
              ? updateStatus?.message
              : mode === "ios"
                ? "In Safari, tap Share, then Add to Home Screen. Navi opens full-screen and keeps chats, projects, and drafts on this device."
                : "Add Navi to your device for a full-screen workspace and faster return access."}
          </span>
        </span>
        <button
          type="button"
          onClick={mode === "update" ? () => setDismissedUpdate(true) : dismissInstall}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
          aria-label={mode === "update" ? "Update later" : "Dismiss install guidance"}
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-3 flex gap-2 pl-[56px]">
        {mode === "update" ? (
          <>
            <button type="button" onClick={requestPwaUpdate} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-[13px]/5 font-semibold text-white active:bg-accent-pressed"><RefreshCw size={16} />Update now</button>
            <button type="button" onClick={() => setDismissedUpdate(true)} className="min-h-11 rounded-2xl bg-elev-2 px-4 text-[13px]/5 font-semibold text-secondary active:bg-elev-3">Later</button>
          </>
        ) : mode === "install" ? (
          <button type="button" onClick={() => void install()} disabled={installing} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-[13px]/5 font-semibold text-white active:bg-accent-pressed disabled:opacity-60"><Download size={16} />{installing ? "Opening installer…" : "Install app"}</button>
        ) : (
          <button type="button" onClick={dismissInstall} className="min-h-11 flex-1 rounded-2xl bg-elev-2 px-4 text-[13px]/5 font-semibold text-secondary active:bg-elev-3">Got it</button>
        )}
      </div>
    </aside>
  );
}
