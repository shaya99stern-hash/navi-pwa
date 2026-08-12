"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { InstallSheet } from "./install-sheet";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallButton({ haptics }: { haptics: boolean }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  /* Only reached where the browser offers no prompt of its own — every iOS
     install, and any desktop browser that declines to fire one. */
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const appInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    haptic("impact-light", haptics);
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setPromptEvent(null);
      return;
    }

    /* No system dialog. `window.alert` is titled with the bare hostname and
       styled by the OS, which is the one thing you cannot show someone at the
       moment you are asking them to install your app. */
    setSheetOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-elev-1 px-4 text-[0.8125rem]/5 font-semibold text-secondary shadow-sm active:bg-elev-2"
      >
        <Download size={16} />
        Install NaviOS
      </button>
      <InstallSheet open={sheetOpen} ios={isIos()} haptics={haptics} onClose={() => setSheetOpen(false)} />
    </>
  );
}
