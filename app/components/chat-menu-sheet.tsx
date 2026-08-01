"use client";

import { Eraser, FolderKanban, PencilLine, Share, Star, Trash2 } from "lucide-react";
import type { NaviProject, StoredChat } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * Per-chat actions, reached from the chat title in the header. This is the
 * chat's own menu — app-wide settings live behind the sidebar footer, and
 * mixing the two is what made the old header ellipsis land people in
 * Settings when they wanted to rename a conversation.
 */

type Props = {
  open: boolean;
  chat: StoredChat | null;
  projects: NaviProject[];
  haptics: boolean;
  onClose: () => void;
  onStar: () => void;
  onRename: () => void;
  onShare: () => void;
  onAddToProject: () => void;
  onClearThread: () => void;
  onDelete: () => void;
};

function MenuRow({ icon, label, danger, onPick }: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex min-h-[52px] w-full items-center gap-3 px-5 text-left text-[1rem]/6 font-normal active:bg-elev-2 ${danger ? "text-danger" : "text-primary"}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function ChatMenuSheet({
  open,
  chat,
  projects,
  haptics,
  onClose,
  onStar,
  onRename,
  onShare,
  onAddToProject,
  onClearThread,
  onDelete
}: Props) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics });
  if (!open || !chat) return null;

  const pick = (action: () => void) => {
    haptic("selection", haptics);
    onClose();
    action();
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <button type="button" aria-label="Close chat menu" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Chat actions"
        className="navi-sheet relative mx-auto w-full max-w-[480px] overflow-hidden pb-[calc(10px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab pt-1"><div className="navi-sheet-grabber" /></div>
        <div className="truncate px-5 pb-1 pt-1 text-center text-[0.8125rem]/5 font-medium text-tertiary">{chat.title}</div>

        {/* Star maps onto the existing pin: one "keep this at the top" concept,
            surfaced with the label people reach for. */}
        <MenuRow icon={<Star size={19} strokeWidth={1.8} className={chat.pinned ? "fill-current text-accent" : ""} />} label={chat.pinned ? "Unstar" : "Star"} onPick={() => pick(onStar)} />
        <MenuRow icon={<PencilLine size={19} strokeWidth={1.8} />} label="Rename" onPick={() => pick(onRename)} />
        <MenuRow icon={<Share size={19} strokeWidth={1.8} />} label="Share" onPick={() => pick(onShare)} />
        {projects.length ? (
          <MenuRow icon={<FolderKanban size={19} strokeWidth={1.8} />} label={chat.projectId ? "Move to project" : "Add to project"} onPick={() => pick(onAddToProject)} />
        ) : null}
        <MenuRow icon={<Eraser size={19} strokeWidth={1.8} />} label="Clear messages" onPick={() => pick(onClearThread)} />
        <div className="mx-5 my-1 border-t border-[var(--border-subtle)]" />
        <MenuRow danger icon={<Trash2 size={19} strokeWidth={1.8} />} label="Delete" onPick={() => pick(onDelete)} />
      </section>
    </div>
  );
}
