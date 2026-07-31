"use client";

import {
  FolderKanban,
  MessageCircle,
  Pin,
  PinOff,
  Search,
  Settings,
  Shapes,
  SquarePen,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StoredChat } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Props = {
  open: boolean;
  /** 0-1 while an edge swipe is in progress, null when idle. */
  dragProgress?: number | null;
  chats: StoredChat[];
  activeId: string;
  haptics: boolean;
  onClose: () => void;
  onNew: () => void;
  onProjects: () => void;
  onArtifacts: () => void;
  onSettings: () => void;
  onOpen: (chat: StoredChat) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

export function HistoryDrawer({ open, dragProgress = null, chats, activeId, haptics, onClose, onNew, onProjects, onArtifacts, onSettings, onOpen, onRename, onPin, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StoredChat | null>(null);
  const holdTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const actionSheet = useSheetDrag({ open: selected !== null, onDismiss: () => setSelected(null), haptics });
  const startX = useRef<number | null>(null);

  useEffect(() => {
    if (open && dragProgress === null) haptic("impact-light", haptics);
    if (!open) {
      setSelected(null);
      setQuery("");
    }
  }, [dragProgress, haptics, open]);

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  const dragging = dragProgress !== null;
  if (!open && !dragging) return null;
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? chats.filter((chat) => `${chat.title} ${chat.preview}`.toLowerCase().includes(normalized))
    : chats;
  const pinned = visible.filter((chat) => chat.pinned);
  const recents = visible.filter((chat) => !chat.pinned);

  function beginHold(chat: StoredChat, clientX?: number) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    startX.current = typeof clientX === "number" ? clientX : null;
    holdTimer.current = window.setTimeout(() => {
      setSelected(chat);
      haptic("impact-medium", haptics);
    }, 480);
  }

  function cancelHold(chat?: StoredChat, clientX?: number) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (chat && typeof clientX === "number" && startX.current !== null && startX.current - clientX > 58) {
      setSelected(chat);
      haptic("impact-light", haptics);
    }
    startX.current = null;
  }

  /** Sidebar destinations are sheets, not routes — close the drawer, then present. */
  function openSheet(present: () => void) {
    haptic("selection", haptics);
    onClose();
    present();
  }

  function showAllChats() {
    haptic("selection", haptics);
    setQuery("");
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rename(chat: StoredChat) {
    const title = window.prompt("Rename chat", chat.title)?.trim();
    if (title) onRename(chat.id, title.slice(0, 100));
    setSelected(null);
  }

  function remove(chat: StoredChat) {
    if (!window.confirm(`Delete “${chat.title}” from this device?`)) return;
    haptic("impact-medium", haptics);
    onDelete(chat.id);
    setSelected(null);
  }

  function chatRow(chat: StoredChat) {
    return (
      <div
        key={chat.id}
        onPointerDown={(event) => beginHold(chat, event.clientX)}
        onPointerUp={(event) => cancelHold(chat, event.clientX)}
        onPointerCancel={() => cancelHold()}
        onPointerLeave={() => cancelHold()}
        className={`flex min-h-[44px] items-center rounded-[10px] ${activeId === chat.id ? "bg-elev-2" : "active:bg-elev-2"}`}
      >
        <button type="button" onClick={() => onOpen(chat)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
          <span className="block truncate text-[15px]/5 font-normal text-primary">{chat.title}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        className={`absolute inset-0 bg-overlay ${dragging ? "" : "navi-drawer-scrim"}`}
        style={dragging ? { opacity: dragProgress ?? 0 } : undefined}
        aria-label="Close sidebar"
        onClick={onClose}
      />
      <aside
        className={`safe-top safe-bottom absolute inset-y-0 left-0 flex w-[85vw] max-w-[340px] flex-col bg-[var(--bg-sidebar)] shadow-menu ${dragging ? "" : "drawer-enter"}`}
        style={dragging ? { transform: `translateX(${((dragProgress ?? 0) - 1) * 100}%)`, transition: "none" } : undefined}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-full bg-elev-2 px-3.5">
            <Search size={16} className="shrink-0 text-tertiary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[15px]/5 text-primary outline-none placeholder:text-tertiary" />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-6 w-6 items-center justify-center rounded-full bg-elev-3 text-secondary">
                <X size={13} />
              </button>
            ) : null}
          </label>
        </div>

        <nav className="shrink-0 px-2 pt-2" aria-label="Navigation">
          <button type="button" onClick={onNew} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[15px]/5 font-medium text-primary active:bg-elev-2">
            <SquarePen size={19} strokeWidth={1.8} className="text-secondary" />
            New chat
          </button>
          <button type="button" onClick={showAllChats} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[15px]/5 font-medium text-primary active:bg-elev-2">
            <MessageCircle size={19} strokeWidth={1.8} className="text-secondary" />
            Chats
          </button>
          <button type="button" onClick={() => openSheet(onProjects)} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[15px]/5 font-medium text-primary active:bg-elev-2">
            <FolderKanban size={19} strokeWidth={1.8} className="text-secondary" />
            Projects
          </button>
          <button type="button" onClick={() => openSheet(onArtifacts)} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[15px]/5 font-medium text-primary active:bg-elev-2">
            <Shapes size={19} strokeWidth={1.8} className="text-secondary" />
            Artifacts
          </button>
        </nav>

        <div ref={listRef} className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-5 pt-3">
          {pinned.length ? (
            <>
              <div className="px-3 pb-1 text-[12px]/4 font-semibold text-tertiary">Pinned</div>
              {pinned.map(chatRow)}
            </>
          ) : null}
          {recents.length ? (
            <>
              <div className={`px-3 pb-1 text-[12px]/4 font-semibold text-tertiary ${pinned.length ? "pt-4" : ""}`}>Recents</div>
              {recents.map(chatRow)}
            </>
          ) : null}
          {!visible.length ? (
            <div className="px-5 py-10 text-center text-[13px]/[18px] font-medium text-tertiary">
              {query ? "No matching chats." : "Your chats will appear here."}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[var(--border-subtle)] px-2 py-2">
          <button type="button" onClick={() => openSheet(onSettings)} className="flex min-h-12 w-full items-center gap-3 rounded-[10px] px-2 text-left active:bg-elev-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-[var(--accent-on-primary)]">
              <UserRound size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]/5 font-medium text-primary">My workspace</span>
              <span className="block text-[11px]/4 font-medium text-tertiary">Private · on this device</span>
            </span>
            <Settings size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
          </button>
        </footer>
      </aside>

      {selected ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center" onClick={() => setSelected(null)}>
          <div aria-hidden="true" {...actionSheet.scrimProps} className="absolute inset-0 bg-overlay" />
          <div {...actionSheet.sheetProps} className="navi-sheet relative w-full max-w-md overflow-hidden pb-[var(--safe-bottom)]" onClick={(event) => event.stopPropagation()}>
            <div {...actionSheet.handleProps} className="navi-sheet-grab pt-1"><div className="navi-sheet-grabber" /></div>
            <div className="border-b border-[var(--border-subtle)] px-5 py-3">
              <div className="truncate text-[15px]/[22px] font-medium text-primary">{selected.title}</div>
              <div className="truncate text-[12px]/4 font-medium text-tertiary">{selected.preview}</div>
            </div>
            <button type="button" onClick={() => { onPin(selected.id, !selected.pinned); setSelected(null); haptic("selection", haptics); }} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[16px]/6 font-normal text-primary active:bg-elev-2">
              {selected.pinned ? <PinOff size={19} strokeWidth={1.8} /> : <Pin size={19} strokeWidth={1.8} />}
              {selected.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" onClick={() => rename(selected)} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[16px]/6 font-normal text-primary active:bg-elev-2">
              <SquarePen size={19} strokeWidth={1.8} />
              Rename
            </button>
            <button type="button" onClick={() => remove(selected)} className="flex min-h-[54px] w-full items-center gap-3 px-5 text-left text-[16px]/6 font-normal text-danger active:bg-elev-2">
              <Trash2 size={19} strokeWidth={1.8} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
