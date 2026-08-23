"use client";

import { Check } from "lucide-react";
import type { EffortLevel, NaviPreferences } from "@/lib/ai/types";
import { EFFORT_EXPLAINER, EFFORT_LEVELS } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

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
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        aria-label="Close effort picker"
        onClick={onClose}
        {...sheet.scrimProps}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
      />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Choose effort"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[500px] px-2 pb-[calc(10px+var(--safe-bottom))] pt-1"
      >
        {/* Invisible handle strictly for the drag logic, no visual dot */}
        <div {...sheet.handleProps} className="h-6 w-full opacity-0" />

        <div className="overflow-hidden rounded-[14px] bg-[#F2F2F7]/95 dark:bg-[#1E1E1E]/95 backdrop-blur-xl shadow-sm">
          <div className="px-4 py-3 border-b border-[#3C3C434A] dark:border-[#545458A6] flex flex-col items-center justify-center text-center">
            <span className="text-[13px] font-semibold text-[#8E8E93]">Effort</span>
            <span className="text-[13px] font-normal text-[#8E8E93] mt-0.5 leading-snug max-w-[95%]">
              {EFFORT_EXPLAINER}
            </span>
          </div>

          {EFFORT_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => pick(level.id)}
              className="flex min-h-[58px] w-full items-center justify-between border-b border-[#3C3C434A] dark:border-[#545458A6] last:border-b-0 px-5 active:bg-black/10 dark:active:bg-white/10 transition-colors"
              aria-pressed={preferences.effort === level.id}
            >
              <div className="flex flex-col items-start text-left min-w-0 pr-4 py-2">
                <span className="text-[20px] font-normal text-primary">{level.label}</span>
                <span className="text-[13px] font-normal text-tertiary mt-0.5">{level.detail}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {level.isDefault ? <span className="text-[13px] text-tertiary">Default</span> : null}
                {preferences.effort === level.id ? <Check size={22} strokeWidth={2} className="text-[#0A84FF]" /> : <span className="w-[22px]" />}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[58px] w-full items-center justify-center rounded-[14px] bg-white dark:bg-[#1E1E1E] text-[20px] font-semibold text-[#0A84FF] active:bg-black/10 dark:active:bg-white/10 transition-colors shadow-sm"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
