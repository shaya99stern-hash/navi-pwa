"use client";

import {
  FolderKanban,
  MessageCircle,
  Pin,
  PinOff,
  Search,
  RefreshCw,
  Settings,
  Shapes,
  SquarePen,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NaviMode, NaviProject, StoredChat } from "@/lib/ai/types";
import { searchConversations } from "@/lib/memory";
import { NAVI_MODES } from "@/lib/chat";
import { PWA_UPDATE_STATUS_EVENT, requestPwaUpdate, type PwaUpdateStatus } from "@/lib/pwa-update";
import { haptic } from "@/lib/ui/haptics";
import { versionLabel } from "@/lib/version";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Props = {
  open: boolean;
  /** 0-1 while an edge swipe is in progress, null when idle. */
  dragProgress?: number | null;
  chats: StoredChat[];
  activeId: string;
  /** Display name from the profile; falls back to the workspace label. */
  profileName?: string;
  /** The active product mode. One brain; this chooses how it works. */
  mode: NaviMode;
  onMode: (mode: NaviMode) => void;
  haptics: boolean;
  onClose: () => void;
  onNew: () => void;
  onProjects: () => void;
  /** Projects, listed in the sidebar rather than hidden behind a sheet. */
  projects: NaviProject[];
  activeProjectId: string | null;
  /** Open a project: makes it active and shows its conversations. */
  onOpenProject: (id: string) => void;
  onArtifacts: () => void;
  onSettings: () => void;
  onOpen: (chat: StoredChat) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

export function HistoryDrawer({ open, dragProgress = null, chats, activeId, profileName, mode, onMode, haptics, onClose, onNew, onProjects, projects, activeProjectId, onOpenProject, onArtifacts, onSettings, onOpen, onRename, onPin, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus | null>(null);
  /* Null until the user picks; the persisted value is the source of truth
     everywhere else. Cleared once the prop catches up. */
  const [optimisticMode, setOptimisticMode] = useState<NaviMode | null>(null);
  const activeMode = optimisticMode ?? mode;

  useEffect(() => {
    if (optimisticMode && optimisticMode === mode) setOptimisticMode(null);
  }, [mode, optimisticMode]);

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
  /* Search reads every message, not the title and preview it used to — anything
     said mid-conversation was unfindable, which is most of what anyone comes
     back looking for. Results are one flat ranked list rather than the usual
     pinned/recent split: when you are searching, relevance is the ordering you
     want, and a pinned chat that merely mentions the word should not sit above
     the thread that is about it. */
  const results = normalized ? searchConversations(query, chats) : [];
  const snippets = new Map(results.map((match) => [match.chat.id, match.snippet]));
  const visible = normalized ? results.map((match) => match.chat) : chats;
  const pinned = normalized ? [] : visible.filter((chat) => chat.pinned);
  const recents = normalized ? visible : visible.filter((chat) => !chat.pinned);

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
          <span className="block truncate text-[0.9375rem]/5 font-normal text-primary">{chat.title}</span>
          {/* Where the term actually appears. A result list of titles alone
              makes you open each one to find out which is the right thread. */}
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
        className={`safe-top safe-bottom absolute inset-y-0 left-0 flex w-[85vw] max-w-[340px] flex-col bg-[var(--bg-sidebar)] shadow-menu ${dragging ? "" : "drawer-enter"}`}
        style={dragging ? { transform: `translateX(${((dragProgress ?? 0) - 1) * 100}%)`, transition: "none" } : undefined}
      >
        {/* The product switch sits above everything, the way a side panel is
            read: what am I working in, then what am I working on. It was in
            the composer, which put a durable choice inside a per-message
            control and meant checking the current mode required looking at
            the send row. */}
        <div className="shrink-0 px-3 pt-3" role="group" aria-label="Mode">
          <div className="flex gap-1 rounded-[12px] bg-elev-1 p-1">
            {NAVI_MODES.map((entry) => {
              const active = entry.id === activeMode;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    haptic("selection", haptics);
                    /* Switching routes the *next* message. The open
                       conversation is untouched — clearing it would make a
                       mode change feel like losing work. */
                    if (entry.id !== mode) {
                      /* Paint the new selection before persisting. The write
                         lands asynchronously, and reopening the drawer before
                         it settled read the old value back — so the control
                         showed the mode the user had just left. */
                      setOptimisticMode(entry.id);
                      onMode(entry.id);
                    }
                    /* The drawer stays open. Closing it turned a segmented
                       control into a one-way exit: you could not see the
                       selection you had just made, and going back to check
                       meant reopening the panel you were thrown out of. */
                  }}
                  aria-pressed={active}
                  className={`min-h-11 flex-1 rounded-[9px] px-2 text-[0.8125rem]/5 font-semibold transition-colors ${active ? "bg-elev-2 text-primary" : "text-tertiary active:bg-elev-2/60"}`}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-full bg-elev-2 px-3.5">
            <Search size={16} className="shrink-0 text-tertiary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[0.9375rem]/5 text-primary outline-none placeholder:text-tertiary" />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-6 w-6 items-center justify-center rounded-full bg-elev-3 text-secondary">
                <X size={13} />
              </button>
            ) : null}
          </label>
        </div>

        <nav className="shrink-0 px-2 pt-2" aria-label="Navigation">
          <button type="button" onClick={onNew} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <SquarePen size={19} strokeWidth={1.8} className="text-secondary" />
            New chat
          </button>
          <button type="button" onClick={showAllChats} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <MessageCircle size={19} strokeWidth={1.8} className="text-secondary" />
            Chats
          </button>
          {/* Projects in both modes.
              The drawer used to swap this row out for Developer and
              "Connectors and keys" whenever Code mode was on — configuration
              surfaces, sitting in primary navigation, replacing the user's own
              content. That is the "why is all this stuff in this side panel"
              complaint, and it is a real category error rather than a matter of
              taste: the sidebar answers *what do I have*, Settings answers
              *how is this set up*. Both of those rows live in Settings already,
              and Settings → Developer now actually opens instead of bouncing
              back, so nothing is lost by holding the line. */}
          <button type="button" onClick={() => openSheet(onProjects)} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <FolderKanban size={19} strokeWidth={1.8} className="text-secondary" />
            Projects
          </button>
          <button type="button" onClick={() => openSheet(onArtifacts)} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[0.9375rem]/5 font-medium text-primary active:bg-elev-2">
            <Shapes size={19} strokeWidth={1.8} className="text-secondary" />
            Artifacts
          </button>
        </nav>

        <div ref={listRef} className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-5 pt-3">
          {/* Projects, in the sidebar where they belong.
              They existed only behind a sheet, so a project was something you
              made once and then never saw again — which is most of why the one
              project in the exported data has no conversations in it. A project
              you cannot see is a project you do not file anything into.

              Hidden while searching: results are ranked across everything, and
              a fixed section above them would push the matches off screen. */}
          {!normalized && projects.length ? (
            <>
              <div className="flex items-center justify-between px-3 pb-1">
                <span className="text-[0.75rem]/4 font-semibold text-tertiary">Projects</span>
                <button
                  type="button"
                  onClick={() => openSheet(onProjects)}
                  className="min-h-8 rounded-full px-2 text-[0.75rem]/4 font-semibold text-secondary active:bg-elev-2"
                >
                  All
                </button>
              </div>
              {projects.slice(0, 6).map((project) => {
                const count = chats.filter((chat) => chat.projectId === project.id).length;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => { haptic("selection", haptics); onClose(); onOpenProject(project.id); }}
                    className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${activeProjectId === project.id ? "bg-elev-2" : "active:bg-elev-2"}`}
                  >
                    <FolderKanban size={17} strokeWidth={1.8} className="shrink-0 text-secondary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem]/5 font-normal text-primary">{project.name}</span>
                      {/* The count is what makes filing feel worthwhile, and
                          what makes an empty project obvious. */}
                      <span className="block text-[0.75rem]/4 font-normal text-tertiary">
                        {count === 0 ? "No conversations yet" : `${count} conversation${count === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="h-3" aria-hidden="true" />
            </>
          ) : null}

          {pinned.length ? (
            <>
              <div className="px-3 pb-1 text-[0.75rem]/4 font-semibold text-tertiary">Pinned</div>
              {pinned.map(chatRow)}
            </>
          ) : null}
          {recents.length ? (
            <>
              <div className={`px-3 pb-1 text-[0.75rem]/4 font-semibold text-tertiary ${pinned.length ? "pt-4" : ""}`}>Recents</div>
              {recents.map(chatRow)}
            </>
          ) : null}
          {!visible.length ? (
            <div className="px-5 py-10 text-center text-[0.8125rem]/[1.125rem] font-medium text-tertiary">
              {query ? `Nothing found for “${query.trim()}”.` : "Your chats will appear here."}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[var(--border-subtle)] px-2 py-2">
          {/* Present only when there is genuinely something to install.
              This used to be a permanent row reading "NaviOS is up to date" —
              build management sitting in primary navigation, beside Chats and
              Projects, saying nothing on every single open. Checking for an
              update is a Settings act and lives in Settings → Account → App.

              What could not simply move there is discovery: an installed PWA
              updates invisibly, and people were reinstalling the app because
              they could not find this. So the row survives for the one state
              that is worth interrupting navigation for — an update actually
              waiting — and is absent the rest of the time. A control that
              appears when it has something to do is not clutter; a control
              that reports "nothing to do" forever is. */}
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
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[0.8125rem] font-semibold text-[var(--accent-on-primary)]">
              <UserRound size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem]/5 font-medium text-primary">{profileName || "My workspace"}</span>
              <span className="block text-[0.6875rem]/4 font-medium text-tertiary">Private · on this device</span>
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
