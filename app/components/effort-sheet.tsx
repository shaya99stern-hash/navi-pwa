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
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close effort picker"
        onClick={onClose}
        {...sheet.scrimProps}
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-md transition-opacity outline-none tap-highlight-transparent"
      />
      
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Choose effort"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[360px] px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-1"
      >
        {/* Invisible handle strictly for the drag logic */}
        <div {...sheet.handleProps} className="h-6 w-full opacity-0 outline-none" />

        {/* Main Options Group */}
        <div className="overflow-hidden rounded-[16px] bg-[#FFFFFF]/90 dark:bg-[#161616]/90 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-2xl">
          {EFFORT_LEVELS.map((level, index) => {
            const isActive = preferences.effort === level.id;
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => pick(level.id)}
                className={`flex h-[48px] w-full items-center justify-between px-4 transition-colors active:bg-black/5 dark:active:bg-white/10 outline-none ${
                  index !== EFFORT_LEVELS.length - 1 ? "border-b border-black/5 dark:border-white/5" : ""
                }`}
                aria-pressed={isActive}
              >
                <span className={`text-[15px] font-medium tracking-tight ${
                  isActive 
                    ? "text-black dark:text-white" 
                    : "text-[#8E8E93] dark:text-[#A1A1A6]"
                }`}>
                  {level.label}
                </span>
                
                <div className="flex w-6 items-center justify-end shrink-0">
                  {isActive && (
                    <Check size={18} strokeWidth={2.5} className="text-black dark:text-white" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Cancel Button */}
        <div className="mt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-[48px] w-full items-center justify-center rounded-[16px] bg-[#FFFFFF]/90 dark:bg-[#161616]/90 backdrop-blur-2xl border border-black/5 dark:border-white/5 text-[15px] font-medium text-[#8E8E93] dark:text-[#A1A1A6] active:bg-black/5 dark:active:bg-white/10 transition-colors outline-none shadow-2xl"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
