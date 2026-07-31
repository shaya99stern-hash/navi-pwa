"use client";

import { Check, Copy, PencilLine, RotateCcw, Share, TextCursorInput } from "lucide-react";
import { useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Props = {
  text: string;
  canRetry: boolean;
  canEdit: boolean;
  haptics: boolean;
  onClose: () => void;
  onRetry: () => void;
  onEdit: () => void;
};

/** Long-press actions for a single message, presented as a native-style sheet. */
export function MessageActionSheet({ text, canRetry, canEdit, haptics, onClose, onRetry, onEdit }: Props) {
  const [copied, setCopied] = useState(false);
  const sheet = useSheetDrag({ onDismiss: onClose, haptics });

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    haptic("success", haptics);
    window.setTimeout(onClose, 500);
  }

  async function share() {
    haptic("selection", haptics);
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // Cancelled by the user.
      }
      onClose();
      return;
    }
    await copy();
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col justify-end" onClick={onClose}>
      {/* iOS lifts the item out of the page and blurs everything behind it, so
          the menu reads as attached to that message rather than to the screen.
          The preview is the lifted copy; the sheet below carries the actions. */}
      <div aria-hidden="true" {...sheet.scrimProps} className="absolute inset-0 bg-overlay backdrop-blur-[6px]" />
      <div className="navi-context-preview relative mx-auto w-full max-w-md px-4 pb-3">
        <p className="line-clamp-4 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-4 py-3 text-[0.9375rem]/[1.375rem] font-normal text-primary shadow-menu">
          {text.slice(0, 240)}{text.length > 240 ? "…" : ""}
        </p>
      </div>
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        className="navi-sheet relative w-full max-w-md overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div {...sheet.handleProps} className="navi-sheet-grab pt-1">
          <div className="navi-sheet-grabber" />
        </div>

        <button type="button" onClick={() => void copy()} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
          {copied ? <Check size={19} strokeWidth={1.8} className="text-success" /> : <Copy size={19} strokeWidth={1.8} />}
          {copied ? "Copied" : "Copy"}
        </button>

        <button type="button" onClick={() => void share()} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
          <Share size={19} strokeWidth={1.8} />
          Share
        </button>

        {canEdit ? (
          <button type="button" onClick={() => { haptic("selection", haptics); onClose(); onEdit(); }} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
            <PencilLine size={19} strokeWidth={1.8} />
            Edit and resend
          </button>
        ) : null}

        {canRetry ? (
          <button type="button" onClick={() => { haptic("selection", haptics); onClose(); onRetry(); }} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
            <RotateCcw size={19} strokeWidth={1.8} />
            Try again
          </button>
        ) : null}

        <div className="flex min-h-[46px] items-center gap-3 px-5 text-[0.75rem]/4 font-medium text-tertiary">
          <TextCursorInput size={16} strokeWidth={1.8} />
          Tap and hold the text itself to select part of it
        </div>
      </section>
    </div>
  );
}
