"use client";

import { Check } from "lucide-react";
import type { EffortLevel, NaviPreferences } from "@/lib/ai/types";
import { EFFORT_LEVELS } from "@/lib/chat";
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
    if (typeof haptic !== "undefined") haptic("selection", preferences.haptics);
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
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[380px] px-3 pb-[calc(16px+var(--safe-bottom))] pt-1"
      >
        {/* Invisible handle strictly for the drag logic, no visual dot */}
        <div {...sheet.handleProps} className="h-6 w-full opacity-0" />

        <div className="overflow-hidden rounded-[14px] bg-[#F2F2F7]/95 dark:bg-[#1E1E1E]/95 backdrop-blur-xl shadow-sm">
          {EFFORT_LEVELS.map((level) => {
            const isActive = preferences.effort === level.id;
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => pick(level.id)}
                className="flex h-[52px] w-full items-center justify-between border-b border-[#3C3C434A] dark:border-[#545458A6] last:border-b-0 px-4 active:bg-black/10 dark:active:bg-white/10 transition-colors"
                aria-pressed={isActive}
              >
                <span className="text-[17px] font-medium tracking-[-0.41px] text-black dark:text-white">
                  {level.label}
                </span>
                
                <div className="flex w-6 items-center justify-end shrink-0">
                  {isActive && (
                    <Check size={20} strokeWidth={2.5} className="text-[#0A84FF]" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-[52px] w-full items-center justify-center rounded-[14px] bg-white dark:bg-[#1E1E1E]/95 backdrop-blur-xl text-[17px] font-semibold tracking-[-0.41px] text-[#0A84FF] active:bg-black/10 dark:active:bg-white/10 transition-colors shadow-sm"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
