"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { EffortLevel, ModelPreset, NaviPreferences } from "@/lib/ai/types";
import { EFFORT_EXPLAINER, EFFORT_LEVELS, MODEL_PRESETS } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * The model picker is a per-message control, so it hangs off the composer
 * pill rather than living inside Settings.
 *
 * It lists exactly two entries. Navi Soul dispatches to whichever engine leads
 * at the job; Navi Code assumes a technical conversation. Provider routes are
 * not offered here at all — picking one should never be part of asking a
 * question — but an override set in Settings surfaces so it is never a mystery
 * why answers changed.
 */

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
};

type Pane = "models" | "effort";

function PickRow({ label, detail, selected, onPick }: {
  label: string;
  detail?: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button type="button" onClick={onPick} className="flex min-h-[56px] w-full items-center gap-3 px-5 py-2 text-left active:bg-elev-2" aria-pressed={selected}>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem]/[1.375rem] font-semibold text-primary">{label}</span>
        {detail ? <span className="block text-[0.8125rem]/[1.125rem] text-tertiary">{detail}</span> : null}
      </span>
      {selected ? <Check size={19} strokeWidth={2.2} className="shrink-0 text-accent" /> : null}
    </button>
  );
}

function SubmenuRow({ label, value, onOpen }: { label: string; value?: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[50px] w-full items-center gap-2 px-5 text-left active:bg-elev-2">
      <span className="flex-1 text-[0.9375rem]/[1.375rem] font-medium text-primary">{label}</span>
      {value ? <span className="text-[0.9375rem]/5 text-tertiary">{value}</span> : null}
      <ChevronRight size={17} className="shrink-0 text-tertiary" />
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

  const primary = MODEL_PRESETS.filter((preset) => !preset.overflow);
  /* If a diagnostic override is active, show it here so it is never a mystery
     why answers changed — but it is set in Settings, not chosen here. */
  const override = MODEL_PRESETS.find((preset) => preset.overflow && preset.id === preferences.preset);
  const effort = EFFORT_LEVELS.find((level) => level.id === preferences.effort) ?? EFFORT_LEVELS[1];

  const pickModel = (preset: ModelPreset) => {
    onPreferences({ ...preferences, preset });
    haptic("selection", preferences.haptics);
    onClose();
  };
  const pickEffort = (level: EffortLevel) => {
    onPreferences({ ...preferences, effort: level });
    haptic("selection", preferences.haptics);
    setPane("models");
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <button type="button" aria-label="Close model picker" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a model"
        className="navi-sheet relative mx-auto flex max-h-[80dvh] w-full max-w-[480px] flex-col overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        {pane !== "models" ? (
          <header className="flex h-11 shrink-0 items-center px-2">
            <button type="button" onClick={() => setPane("models")} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-primary active:bg-elev-2">
              <ChevronLeft size={20} strokeWidth={1.8} />
            </button>
            <span className="flex-1 text-center text-[0.9375rem]/5 font-semibold text-primary">
              Effort
            </span>
            <span className="h-10 w-10" aria-hidden="true" />
          </header>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {pane === "models" ? (
            <>
              {primary.map((preset) => (
                <PickRow
                  key={preset.id}
                  label={preset.label}
                  detail={preset.detail}
                  selected={preferences.preset === preset.id}
                  onPick={() => pickModel(preset.id)}
                />
              ))}
              {override ? (
                <PickRow
                  label={override.label}
                  detail="Diagnostic override — change in Settings → Capabilities"
                  selected
                  onPick={() => pickModel("navi-soul")}
                />
              ) : null}
              <div className="mx-5 my-1 border-t border-[var(--border-subtle)]" />
              <SubmenuRow label="Effort" value={effort.label} onOpen={() => { haptic("selection", preferences.haptics); setPane("effort"); }} />
            </>
          ) : null}

          {pane === "effort" ? (
            <>
              <p className="px-5 pb-2 pt-1 text-[0.8125rem]/[1.25rem] text-tertiary">{EFFORT_EXPLAINER}</p>
              {EFFORT_LEVELS.map((level) => (
                <button key={level.id} type="button" onClick={() => pickEffort(level.id)} className="flex min-h-[54px] w-full items-center gap-3 px-5 py-2 text-left active:bg-elev-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem]/[1.375rem] font-medium text-primary">{level.label}</span>
                    <span className="block text-[0.8125rem]/[1.125rem] text-tertiary">{level.detail}</span>
                  </span>
                  {level.isDefault ? <span className="shrink-0 text-[0.8125rem]/4 text-tertiary">Default</span> : null}
                  {preferences.effort === level.id ? <Check size={18} strokeWidth={2.2} className="shrink-0 text-accent" /> : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
