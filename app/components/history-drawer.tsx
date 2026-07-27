"use client";

import { MoreHorizontal, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StoredChat } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";

type Props = {
  open: boolean;
  chats: StoredChat[];
  activeId: string;
  haptics: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (chat: StoredChat) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

function relativeTime(value: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return "Now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryDrawer({ open, chats, activeId, haptics, onClose, onNew, onOpen, onRename, onPin, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StoredChat | null>(null);
  const holdTimer = useRef<number | null>(null);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    if (open) haptic("impact-light", haptics);
    if (!open) setSelected(null);
  }, [haptics, open]);

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  if (!open) return null;
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? chats.filter((chat) => `${chat.title} ${chat.preview}`.toLowerCase().includes(normalized))
    : chats;

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

  function rename(chat: StoredChat) {
    const title = window.prompt("Rename conversation", chat.title)?.trim();
    if (title) onRename(chat.id, title.slice(0, 100));
    setSelected(null);
  }

  function remove(chat: StoredChat) {
    if (!window.confirm(`Delete “${chat.title}” from this device?`)) return;
    haptic("impact-medium", haptics);
    onDelete(chat.id);
    setSelected(null);
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <button type="button" className="absolute inset-0 bg-overlay backdrop-blur-[2px]" aria-label="Close conversation history" onClick={onClose} />
      <aside className="drawer-enter safe-top safe-bottom absolute inset-y-0 left-0 flex w-[86vw] max-w-[360px] flex-col border-r border-[var(--border-subtle)] bg-elev-1 shadow-menu">
        <header className="flex h-14 shrink-0 items-center justify-between px-3">
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close history"><X size={21} /></button>
          <span className="text-[17px]/6 font-semibold tracking-[-0.01em] text-primary">History</span>
          <button type="button" onClick={onNew} className="flex h-11 w-11 items-center justify-center rounded-full text-primary active:bg-elev-3" aria-label="New conversation"><Plus size={21} /></button>
        </header>

        <div className="px-3 pb-3">
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-3">
            <Search size={17} className="shrink-0 text-tertiary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-[15px]/[22px] text-primary outline-none placeholder:text-tertiary" />
          </label>
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-5">
          {visible.length ? visible.map((chat) => (
            <div
              key={chat.id}
              onPointerDown={(event) => beginHold(chat, event.clientX)}
              onPointerUp={(event) => cancelHold(chat, event.clientX)}
              onPointerCancel={() => cancelHold()}
              onPointerLeave={() => cancelHold()}
              className={`group mb-1 flex min-h-[66px] items-center rounded-2xl ${activeId === chat.id ? "bg-[var(--selection-bg)]" : "active:bg-elev-2"}`}
            >
              <button type="button" onClick={() => onOpen(chat)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                <span className="flex items-center gap-1.5">
                  {chat.pinned ? <Pin size={12} className="shrink-0 text-accent" /> : null}
                  <span className="truncate text-[15px]/[22px] font-medium text-primary">{chat.title}</span>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px]/4 font-medium text-tertiary">{chat.preview}</span>
                  <time className="shrink-0 text-[11px]/[14px] font-semibold text-tertiary">{relativeTime(chat.updatedAt)}</time>
                </span>
              </button>
              <button type="button" onClick={() => setSelected(chat)} className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-tertiary active:bg-elev-3" aria-label={`Conversation actions for ${chat.title}`}><MoreHorizontal size={18} /></button>
            </div>
          )) : <div className="px-5 py-10 text-center text-[13px]/[18px] font-medium text-tertiary">No matching conversations.</div>}
        </div>

        <footer className="border-t border-[var(--border-subtle)] px-4 py-3 text-[11px]/[14px] font-semibold text-tertiary">Swipe a row left or long-press for actions. Stored only on this device.</footer>
      </aside>

      {selected ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-overlay px-3 pb-[calc(12px+var(--safe-bottom))]" onClick={() => setSelected(null)}>
          <div className="context-enter w-full max-w-md overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-elev-2 shadow-menu" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <div className="truncate text-[15px]/[22px] font-medium text-primary">{selected.title}</div>
              <div className="truncate text-[12px]/4 font-medium text-tertiary">{selected.preview}</div>
            </div>
            <button type="button" onClick={() => rename(selected)} className="min-h-[54px] w-full border-b border-[var(--border-subtle)] px-4 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-3">Rename</button>
            <button type="button" onClick={() => { onPin(selected.id, !selected.pinned); setSelected(null); haptic("selection", haptics); }} className="flex min-h-[54px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-4 text-left text-[15px]/[22px] font-medium text-primary active:bg-elev-3">{selected.pinned ? <PinOff size={18} /> : <Pin size={18} />}{selected.pinned ? "Unpin" : "Pin"}</button>
            <button type="button" onClick={() => remove(selected)} className="flex min-h-[54px] w-full items-center gap-3 px-4 text-left text-[15px]/[22px] font-medium text-danger active:bg-elev-3"><Trash2 size={18} />Delete</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
