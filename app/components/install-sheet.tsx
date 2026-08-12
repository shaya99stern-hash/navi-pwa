"use client";

import { Share, SquarePlus } from "lucide-react";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * How to put NaviOS on the Home Screen, in NaviOS.
 *
 * This replaced `window.alert("In Safari, tap the Share button…")` — a grey
 * system dialog titled with the bare hostname, raised at the exact moment the
 * app is asking someone to trust it enough to install it. Nothing else in the
 * product broke character that hard.
 *
 * The steps carry the real glyphs, because the instruction is "find this icon"
 * and a sentence describing an icon is a worse way to say that than the icon.
 */
export function InstallSheet({
  open,
  ios,
  haptics,
  onClose
}: {
  open: boolean;
  /** iOS has no install prompt, so its path is these two manual steps. */
  ios: boolean;
  haptics: boolean;
  onClose: () => void;
}) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics });
  if (!open) return null;

  const steps = ios
    ? [
        { text: "Tap Share in the Safari toolbar", icon: <Share size={21} strokeWidth={1.8} className="text-info" /> },
        { text: "Choose Add to Home Screen", icon: <SquarePlus size={21} strokeWidth={1.8} className="text-success" /> }
      ]
    : [
        { text: "Open your browser menu", icon: <Share size={21} strokeWidth={1.8} className="text-info" /> },
        { text: "Choose Install app or Add to Home Screen", icon: <SquarePlus size={21} strokeWidth={1.8} className="text-success" /> }
      ];

  return (
    <div className="fixed inset-0 z-[120] flex flex-col justify-end">
      <button type="button" aria-label="Close" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Add to Home Screen"
        className="navi-sheet relative mx-auto w-full max-w-[480px] overflow-hidden px-5 pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab -mx-5 shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        <h3 className="hero-title mb-1.5 mt-3.5 text-[1.375rem]/7 font-normal tracking-[-0.015em] text-primary">
          Put NaviOS on your Home Screen
        </h3>
        <p className="mb-4 max-w-[32ch] text-[0.84375rem]/[1.3rem] font-normal text-secondary">
          It runs full-screen, keeps your conversations offline, and stops the browser from reloading the shell.
        </p>

        <ol className="flex flex-col gap-2.5">
          {steps.map((step, index) => (
            <li key={step.text} className="flex items-center gap-3 rounded-[14px] bg-elev-2 p-3.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-elev-3 text-[0.8125rem]/none font-semibold text-secondary">
                {index + 1}
              </span>
              <span className="flex-1 text-[0.84375rem]/[1.2rem] font-medium text-primary">{step.text}</span>
              <span className="shrink-0">{step.icon}</span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onClose}
          className="mt-[18px] min-h-[50px] w-full rounded-full bg-accent text-[0.9375rem]/[1.125rem] font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed"
        >
          Got it
        </button>
      </section>
    </div>
  );
}
