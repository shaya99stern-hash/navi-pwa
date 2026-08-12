"use client";

import { Check } from "lucide-react";
import type { NaviMode, NaviPreferences } from "@/lib/ai/types";
import { NAVI_MODES } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * Which product you are talking to.
 *
 * One brain — Navi Soul — sits behind both; this chooses how it works, not
 * which model answers. It used to be a segmented control at the top of the
 * drawer, which put a durable choice above a panel that otherwise answers
 * "what do I have". It now hangs off the chevron beside the product name in
 * the header, which is the control that already looked like it did this.
 *
 * Switching routes the *next* message. The open conversation is untouched:
 * clearing it would make a mode change feel like losing work.
 */
export function ModeSheet({
  open,
  preferences,
  onClose,
  onPreferences
}: {
  open: boolean;
  preferences: NaviPreferences;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
}) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics: preferences.haptics });
  if (!open) return null;

  const pick = (mode: NaviMode) => {
    if (mode !== preferences.mode) onPreferences({ ...preferences, mode });
    haptic("selection", preferences.haptics);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <button type="button" aria-label="Close product picker" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Choose product"
        className="navi-sheet relative mx-auto flex max-h-[80dvh] w-full max-w-[480px] flex-col overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        <div className="mb-3 ml-5 mt-2.5 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-tertiary">Product</div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-1">
          {NAVI_MODES.map((entry) => {
            const active = entry.id === preferences.mode;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => pick(entry.id)}
                aria-pressed={active}
                className={`flex min-h-[54px] w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left ${active ? "bg-[var(--selection-bg)]" : "active:bg-elev-2"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.90625rem]/[1.1875rem] font-semibold text-primary">{entry.label}</span>
                  <span className="mt-0.5 block text-[0.78125rem]/[1.09375rem] font-normal text-tertiary">{entry.detail}</span>
                </span>
                {active ? <Check size={19} strokeWidth={2.4} className="shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
