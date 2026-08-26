"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { EffortLevel, ModelPreset, NaviPreferences } from "@/lib/ai/types";
import { DIAGNOSTIC_ROUTES, EFFORT_EXPLAINER, EFFORT_LEVELS } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
};

type Pane = "models" | "effort";
type ModeCopy = { label: string; detail: string };

const MODE_COPY: Partial<Record<ModelPreset, ModeCopy>> = {
  "navi-soul": {
    label: "Auto",
    detail: "Chooses the best available route for each request."
  },
  "navi-soul-deep": {
    label: "Deep",
    detail: "Stages planning, execution, and review for difficult work."
  },
  "navi-soul-direct": {
    label: "Team",
    detail: "Runs independent routes in parallel, then synthesizes the strongest result."
  }
};

/* Direct provider pins remain in Diagnostics because a provider can be
   unavailable on a deployment. These three Navi Soul routes are stable product
   choices. They are orchestration modes, not raw model names, so the picker
   describes them truthfully. */
const COMPOSER_MODES = DIAGNOSTIC_ROUTES.filter(({ id }) => id.startsWith("navi-soul"));

function PickRow({ label, detail, selected, onPick }: {
  label: string;
  detail: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-h-[58px] w-full items-center gap-3 px-5 py-2 text-left active:bg-elev-2"
      aria-pressed={selected}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]/[22px] font-semibold text-primary">{label}</span>
        <span className="block text-[13px]/[18px] text-tertiary">{detail}</span>
      </span>
      {selected ? <Check size={19} strokeWidth={2.2} className="shrink-0 text-accent" /> : null}
    </button>
  );
}

export function ModelPickerSheet({ open, preferences, onClose, onPreferences }: Props) {
  const [pane, setPane] = useState<Pane>("models");
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics: preferences.haptics });

  useEffect(() => {
    if (open) setPane("models");
  }, [open]);

  if (!open) return null;

  const selectedMode = preferences.routeOverride ?? "navi-soul";
  const effort = EFFORT_LEVELS.find((item) => item.id === preferences.effort) ?? EFFORT_LEVELS[1];

  const pickMode = (model: ModelPreset) => {
    onPreferences({
      ...preferences,
      routeOverride: model === "navi-soul" ? undefined : model
    });
    haptic("selection", preferences.haptics);
    onClose();
  };

  const pickEffort = (level: EffortLevel) => {
    onPreferences({ ...preferences, effort: level });
    haptic("selection", preferences.haptics);
    setPane("models");
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close Navi Soul picker"
        onClick={onClose}
        {...sheet.scrimProps}
        className="absolute inset-0 bg-overlay"
      />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label={pane === "models" ? "Choose Navi Soul mode" : "Choose effort"}
        className="navi-sheet relative mx-auto flex max-h-[80dvh] w-full max-w-[480px] flex-col overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1">
          <div className="navi-sheet-grabber" />
        </div>

        {pane === "effort" ? (
          <header className="flex h-11 shrink-0 items-center px-2">
            <button
              type="button"
              onClick={() => setPane("models")}
              aria-label="Back to Navi Soul modes"
              className="flex h-10 w-10 items-center justify-center rounded-full text-primary active:bg-elev-2"
            >
              <ChevronLeft size={20} strokeWidth={1.8} />
            </button>
            <span className="flex-1 text-center text-[15px]/5 font-semibold text-primary">Effort</span>
            <span className="h-10 w-10" aria-hidden="true" />
          </header>
        ) : (
          <header className="px-5 pb-2 pt-2">
            <h2 className="text-[17px]/6 font-semibold text-primary">Navi Soul</h2>
            <p className="mt-0.5 text-[13px]/5 text-tertiary">Choose how Navi routes and reviews this conversation.</p>
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {pane === "models" ? (
            <>
              {COMPOSER_MODES.map((model) => {
                const copy = MODE_COPY[model.id] ?? { label: model.label, detail: "Use this Navi Soul route." };
                return (
                  <PickRow
                    key={model.id}
                    label={copy.label}
                    detail={copy.detail}
                    selected={selectedMode === model.id}
                    onPick={() => pickMode(model.id)}
                  />
                );
              })}
              <div className="mx-5 my-1 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  haptic("selection", preferences.haptics);
                  setPane("effort");
                }}
                className="flex min-h-[52px] w-full items-center gap-2 px-5 text-left active:bg-elev-2"
              >
                <span className="flex-1 text-[15px]/[22px] font-medium text-primary">Effort</span>
                <span className="text-[15px]/5 text-tertiary">{effort.label}</span>
                <ChevronRight size={17} className="shrink-0 text-tertiary" />
              </button>
            </>
          ) : (
            <>
              <p className="px-5 pb-2 pt-1 text-[13px]/[20px] text-tertiary">{EFFORT_EXPLAINER}</p>
              {EFFORT_LEVELS.map((level) => (
                <PickRow
                  key={level.id}
                  label={level.label}
                  detail={level.detail}
                  selected={preferences.effort === level.id}
                  onPick={() => pickEffort(level.id)}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
