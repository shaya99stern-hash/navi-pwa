"use client";

import { Check } from "lucide-react";
import type { EffortLevel, NaviPreferences } from "@/lib/ai/types";
import { EFFORT_EXPLAINER, EFFORT_LEVELS } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * Effort, and nothing else.
 *
 * This replaced a model picker. There is one brain — NaviSoul — so there was
 * never a model to choose; the picker was offering an implementation detail as
 * though it were a product decision. Which free provider answers is chosen by
 * the router and named nowhere.
 *
 * Effort is the one genuinely per-message lever, which is why it stays on the
 * composer rather than moving to Settings: it is adjusted per task, not
 * configured once.
 */

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
};

export function EffortSheet({ open, preferences, onClose, onPreferences }: Props) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics: preferences.haptics });
  if (!open) return null;

  const pick = (level: EffortLevel) => {
    onPreferences({ ...preferences, effort: level });
    haptic("selection", preferences.haptics);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <button type="button" aria-label="Close effort picker" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Choose effort"
        className="navi-sheet relative mx-auto flex max-h-[80dvh] w-full max-w-[480px] flex-col overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        <header className="shrink-0 px-5 pb-1 pt-1">
          <div className="text-[1.0625rem]/6 font-semibold text-primary">Effort</div>
          <p className="mt-0.5 text-[0.8125rem]/[1.25rem] text-tertiary">{EFFORT_EXPLAINER}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {EFFORT_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => pick(level.id)}
              className="flex min-h-[54px] w-full items-center gap-3 px-5 py-2 text-left active:bg-elev-2"
              aria-pressed={preferences.effort === level.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem]/[1.375rem] font-medium text-primary">{level.label}</span>
                <span className="block text-[0.8125rem]/[1.125rem] text-tertiary">{level.detail}</span>
              </span>
              {level.isDefault ? <span className="shrink-0 text-[0.8125rem]/4 text-tertiary">Default</span> : null}
              {preferences.effort === level.id ? <Check size={18} strokeWidth={2.2} className="shrink-0 text-accent" /> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
