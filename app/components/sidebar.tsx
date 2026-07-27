import { Menu, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import type { StoredChat } from "../lib/chat";

type Props = {
  open: boolean;
  chats: StoredChat[];
  activeId: string;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onNew: () => void;
  onOpen: (chat: StoredChat) => void;
  onDelete: (id: string) => void;
};

export function Sidebar({ open, chats, activeId, search, onSearch, onClose, onNew, onOpen, onDelete }: Props) {
  if (!open) return null;
  const filtered = chats.filter((chat) => chat.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" aria-label="Close sidebar" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="safe-top safe-bottom absolute inset-y-0 left-0 flex w-[min(86vw,330px)] flex-col border-r border-white/10 bg-[#171717] shadow-2xl">
        <div className="flex min-h-14 items-center justify-between px-3">
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 active:bg-white/10" aria-label="Close sidebar"><X size={22} /></button>
          <span className="text-[15px] font-semibold tracking-tight">Navi</span>
          <button type="button" onClick={onNew} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-200 active:bg-white/10" aria-label="New chat"><Plus size={22} /></button>
        </div>

        <div className="px-3 pb-3 pt-1">
          <button type="button" onClick={onNew} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-white/10 px-4 text-left text-[15px] font-medium active:bg-white/10"><MessageSquare size={19} />New chat</button>
        </div>

        <div className="px-3 pb-3">
          <label className="flex min-h-11 items-center gap-2 rounded-xl bg-black/25 px-3">
            <Search size={18} className="shrink-0 text-neutral-500" />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-neutral-600" />
          </label>
        </div>

        <div className="scroll-area flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length ? filtered.map((chat) => (
            <div key={chat.id} className={`mb-1 flex min-h-12 items-center rounded-xl ${chat.id === activeId ? "bg-white/10" : "active:bg-white/[0.07]"}`}>
              <button type="button" onClick={() => onOpen(chat)} className="min-w-0 flex-1 px-3 py-3 text-left"><span className="block truncate text-[14px] text-neutral-200">{chat.title}</span></button>
              <button type="button" aria-label={`Delete ${chat.title}`} onClick={() => onDelete(chat.id)} className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-white/10 active:text-red-300"><Trash2 size={17} /></button>
            </div>
          )) : <div className="px-4 pt-8 text-center text-sm text-neutral-600">No saved chats</div>}
        </div>

        <div className="border-t border-white/10 px-4 py-4 text-[13px] text-neutral-500">History is stored only on this device.</div>
      </aside>
    </div>
  );
}

export function SidebarButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-200 active:bg-white/10" aria-label="Open chat history"><Menu size={23} /></button>;
}
