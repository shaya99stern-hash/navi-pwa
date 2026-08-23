"use client";

import {
  Layers,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  RefreshCw,
  SquarePen,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NaviProject, StoredChat } from "@/lib/ai/types";
import { searchConversations } from "@/lib/memory";
import { PWA_UPDATE_STATUS_EVENT, requestPwaUpdate, type PwaUpdateStatus } from "@/lib/pwa-update";
import { haptic } from "@/lib/ui/haptics";
import { versionLabel } from "@/lib/version";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Props = {
  open: boolean;
  dragProgress?: number | null;
  chats: StoredChat[];
  activeId: string;
  profileName?: string;
  haptics: boolean;
  onClose: () => void;
  onNew: () => void;
  onNewCode: () => void;
  onProjects: () => void;
  projects: NaviProject[];
  onSettings: () => void;
  onOpen: (chat: StoredChat) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

export function HistoryDrawer({ open, dragProgress = null, chats, activeId, haptics, onClose, onNew, onNewCode, onProjects, projects, onSettings, onOpen, onRename, onPin, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus | null>(null);
  
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateStatus>).detail;
      if (detail?.phase && detail.message) setUpdateStatus(detail);
    };
    window.addEventListener(PWA_UPDATE_STATUS_EVENT, receive);
    return () => window.removeEventListener(PWA_UPDATE_STATUS_EVENT, receive);
  }, []);
  
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
  
  const results = normalized ? searchConversations(query, chats) : [];
  const snippets = new Map(results.map((match) => [match.chat.id, match.snippet]));
  const visible = normalized ? results.map((match) => match.chat) : chats;
  const pinned = normalized ? [] : visible.filter((chat) => chat.pinned);
  const recents = normalized ? visible : visible.filter((chat) => !chat.pinned);

  const recentChats = recents.filter((chat) => !(chat as any).isCodeSession);
  const recentCodeSessions = recents.filter((chat) => (chat as any).isCodeSession);

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

  function openSheet(present: () => void) {
    haptic("selection", haptics);
    onClose();
    present();
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
          <span className="block truncate text-[0.9375rem]/5 font-normal text-primary">{chat.title}</span>
          {snippets.get(chat.id) ? (
            <span className="mt-0.5 block truncate text-[0.75rem]/4 font-normal text-tertiary">{snippets.get(chat.id)}</span>
          ) : null}
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
        className={`safe-top safe-bottom absolute inset-y-0 left-0 flex w-[314px] max-w-[86vw] flex-col bg-[var(--bg-sidebar)] shadow-menu ${dragging ? "" : "drawer-enter"}`}
        style={dragging ? { transform: `translateX(${((dragProgress ?? 0) - 1) * 100}%)`, transition: "none" } : undefined}
      >
        <div className="flex min-h-[52px] shrink-0 items-center gap-2 px-3.5 pt-1">
          <span className="navi-orb h-[26px] w-[26px] shrink-0 rounded-full" aria-hidden="true" />
          <span className="text-[0.9375rem]/[1.125rem] font-semibold tracking-[-0.01em] text-primary">NaviOS</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="ml-auto flex h-[38px] w-[38px] items-center justify-center rounded-full text-tertiary active:bg-elev-2"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3.5 pb-1 pt-1.5">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-surface px-3">
            <Search size={16} className="shrink-0 text-disabled" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every message" className="min-w-0 flex-1 bg-transparent text-[0.875rem]/5 text-primary outline-none placeholder:text-disabled" />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-6 w-6 items-center justify-center rounded-full bg-elev-3 text-secondary">
                <X size={13} />
              </button>
            ) : null}
          </label>
        </div>

        <nav className="shrink-0 px-2 pt-2" aria-label="Navigation">
          <button type="button" onClick={() => { onClose(); onNew(); }} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <MessageSquare size={19} strokeWidth={1.8} className="text-secondary" />
            NaviOS Chat
          </button>

          <button type="button" onClick={() => { onClose(); onNewCode(); }} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <SquareTerminal size={19} strokeWidth={1.8} className="text-secondary" />
            NaviOS Code
          </button>

          <button type="button" onClick={() => openSheet(onProjects)} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <Layers size={19} strokeWidth={1.8} className="text-secondary" />
            Projects
            {projects.length ? <span className="ml-auto text-[0.71875rem]/[0.6875rem] font-semibold text-tertiary">{projects.length}</span> : null}
          </button>
        </nav>

        <div className="mx-1.5 my-3 h-px shrink-0 bg-[var(--border-subtle)]" aria-hidden="true" />

        <div ref={listRef} className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-5 pt-3">
          {pinned.length ? (
            <>
              <div className="mb-2 ml-3 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-disabled">Pinned</div>
              {pinned.map(chatRow)}
            </>
          ) : null}
          
          {recentChats.length ? (
            <>
              <div className={`mb-2 ml-3 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-disabled ${pinned.length ? "mt-4" : ""}`}>Recent Chats</div>
              {recentChats.map(chatRow)}
            </>
          ) : null}

          {recentCodeSessions.length ? (
            <>
              <div className={`mb-2 ml-3 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-disabled ${(pinned.length || recentChats.length) ? "mt-4" : ""}`}>Recent Code Sessions</div>
              {recentCodeSessions.map(chatRow)}
            </>
          ) : null}

          {!visible.length ? (
            <div className="px-5 py-10 text-center text-[0.8125rem]/[1.125rem] font-medium text-tertiary">
              {query ? `Nothing found for “${query.trim()}”.` : "Your chats will appear here."}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[var(--border-subtle)] px-2 py-2">
          {updateStatus?.phase === "available" || updateStatus?.phase === "downloading" || updateStatus?.phase === "restarting" ? (
            <button
              type="button"
              onClick={() => {
                haptic("impact-light", haptics);
                requestPwaUpdate();
              }}
              disabled={updateStatus.phase === "downloading" || updateStatus.phase === "restarting"}
              className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 text-left active:bg-elev-2 disabled:opacity-70"
            >
              <RefreshCw size={17} strokeWidth={1.8} className={`shrink-0 text-accent ${updateStatus.phase === "downloading" || updateStatus.phase === "restarting" ? "animate-spin" : ""}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem]/5 font-medium text-primary">
                  {updateStatus.phase === "available" ? "Update ready — tap to install" : "Updating NaviOS…"}
                </span>
                <span className="block truncate text-[0.6875rem]/4 font-medium text-accent">
                  {updateStatus.message ?? versionLabel()}
                </span>
              </span>
            </button>
          ) : null}
          <button type="button" onClick={() => openSheet(onSettings)} className="flex min-h-12 w-full items-center gap-3 rounded-[10px] px-2 text-left active:bg-elev-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E5E5E5] text-[#121214] text-[0.875rem] font-bold shadow-sm">
              S
            </span>
          </button>
        </footer>
      </aside>

      {selected ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center" onClick={() => setSelected(null)}>
          <div aria-hidden="true" {...actionSheet.scrimProps} className="absolute inset-0 bg-overlay" />
          <div {...actionSheet.sheetProps} className="navi-sheet relative w-full max-w-md overflow-hidden pb-[var(--safe-bottom)]" onClick={(event) => event.stopPropagation()}>
            <div {...actionSheet.handleProps} className="navi-sheet-grab pt-1"><div className="navi-sheet-grabber" /></div>
            <div className="border-b border-[var(--border-subtle)] px-5 py-3">
              <div className="truncate text-[0.9375rem]/[1.375rem] font-medium text-primary">{selected.title}</div>
              <div className="truncate text-[0.75rem]/4 font-medium text-tertiary">{selected.preview}</div>
            </div>
            <button type="button" onClick={() => { onPin(selected.id, !selected.pinned); setSelected(null); haptic("selection", haptics); }} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
              {selected.pinned ? <PinOff size={19} strokeWidth={1.8} /> : <Pin size={19} strokeWidth={1.8} />}
              {selected.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" onClick={() => rename(selected)} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[1rem]/6 font-normal text-primary active:bg-elev-2">
              <SquarePen size={19} strokeWidth={1.8} />
              Rename
            </button>
            <button type="button" onClick={() => remove(selected)} className="flex min-h-[54px] w-full items-center gap-3 px-5 text-left text-[1rem]/6 font-normal text-danger active:bg-elev-2">
              <Trash2 size={19} strokeWidth={1.8} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
