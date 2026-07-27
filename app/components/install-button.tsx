"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { haptic } from "@/lib/ui/haptics";

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

    if (isIos()) {
      window.alert("In Safari, tap the Share button, then choose “Add to Home Screen.”");
      return;
    }

    window.alert("Open your browser menu and choose Install app or Add to Home Screen.");
  }

  return (
    <button
      type="button"
      onClick={() => void install()}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-elev-1 px-4 text-[13px]/5 font-semibold text-secondary shadow-sm active:bg-elev-2"
    >
      <Download size={16} />
      Install Navi
    </button>
  );
}
