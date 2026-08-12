"use client";

import { ChevronRight, FileSpreadsheet, FileText, FileType2, ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { StoredChat } from "@/lib/ai/types";
import {
  collectFiles,
  fileKind,
  formatBytes,
  formatWhen,
  isThisWeek,
  totalBytes,
  type FileKind,
  type LibraryFile
} from "@/lib/ui/library";
import { haptic } from "@/lib/ui/haptics";

/** Chip label to the kinds it admits. "All" admits everything. */
const FILTERS: Array<{ id: "all" | FileKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "pdf", label: "PDF" },
  { id: "text", label: "Text" },
  { id: "data", label: "Data" }
];

const ICONS: Record<FileKind, { Icon: typeof FileText; tint: string; wash: string }> = {
  pdf: { Icon: FileType2, tint: "var(--accent-danger)", wash: "rgba(224,130,122,.16)" },
  text: { Icon: FileText, tint: "var(--accent-success)", wash: "rgba(123,174,127,.16)" },
  data: { Icon: FileSpreadsheet, tint: "var(--accent-info)", wash: "rgba(106,155,204,.16)" },
  image: { Icon: ImageIcon, tint: "var(--accent-warning)", wash: "rgba(212,162,127,.16)" }
};

function FileRow({ file, onOpen, haptics }: { file: LibraryFile; onOpen: () => void; haptics: boolean }) {
  const kind = fileKind(file.type, file.name);
  const { Icon, tint, wash } = ICONS[kind];
  return (
    <button
      type="button"
      onClick={() => { haptic("selection", haptics); onOpen(); }}
      className="flex min-h-16 w-full items-center gap-3 rounded-[14px] bg-surface p-2.5 text-left active:bg-elev-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]" style={{ background: wash }}>
        <Icon size={18} strokeWidth={1.9} style={{ color: tint }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.90625rem]/[1.1875rem] font-semibold text-primary">{file.name}</span>
        <span className="mt-0.5 block truncate text-[0.78125rem]/[1.0625rem] font-normal text-tertiary">
          {formatBytes(file.size)} · {file.chatTitle} · {formatWhen(file.sentAt)}
        </span>
      </span>
      <ChevronRight size={17} strokeWidth={2} className="shrink-0 text-disabled" />
    </button>
  );
}

/**
 * Everything sent into a conversation, in one place.
 *
 * Reads straight off the stored chats — an attachment's only home is the chat
 * it was sent in, so opening a row reopens that conversation rather than
 * pretending the app has a file store it does not have.
 */
export function FilesScreen({
  chats,
  haptics,
  onOpenChat
}: {
  chats: StoredChat[];
  haptics: boolean;
  onOpenChat: (chatId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | FileKind>("all");
  const files = useMemo(() => collectFiles(chats), [chats]);

  const visible = filter === "all" ? files : files.filter((file) => fileKind(file.type, file.name) === filter);
  const week = visible.filter((file) => isThisWeek(file.sentAt));
  const earlier = visible.filter((file) => !isThisWeek(file.sentAt));

  return (
    <div className="navi-screen min-h-full px-gutter pb-6 pt-3.5">
      <div className="mx-auto w-full max-w-app">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="font-display text-[1.625rem]/8 tracking-[-0.02em] text-primary">Files</h2>
          <span className="shrink-0 text-[0.75rem]/[1.05rem] font-medium text-tertiary">
            {files.length} · {formatBytes(totalBytes(files))} on device
          </span>
        </div>
        <p className="mb-4 mt-1.5 max-w-[34ch] text-[0.84375rem]/[1.265rem] font-normal text-tertiary">
          Everything you have attached, kept on this device. Tap to reopen the conversation it belongs to.
        </p>

        <div className="scroll-area mb-4 flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => { haptic("selection", haptics); setFilter(entry.id); }}
                aria-pressed={active}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[0.78125rem]/[0.9375rem] font-semibold ${
                  active
                    ? "bg-accent text-[var(--accent-on-primary)]"
                    : "border border-[var(--border-strong)] text-secondary active:bg-elev-2"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        {!visible.length ? (
          <div className="rounded-[16px] border border-[var(--border-subtle)] bg-surface px-5 py-10 text-center">
            <p className="text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
              {files.length ? "Nothing of that kind yet." : "Files you attach to a conversation appear here."}
            </p>
          </div>
        ) : null}

        {week.length ? (
          <>
            <div className="mb-2.5 ml-0.5 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-tertiary">
              This week
            </div>
            <div className="flex flex-col gap-0.5">
              {week.map((file) => (
                <FileRow key={file.id} file={file} haptics={haptics} onOpen={() => onOpenChat(file.chatId)} />
              ))}
            </div>
          </>
        ) : null}

        {earlier.length ? (
          <>
            <div className={`mb-2.5 ml-0.5 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-tertiary ${week.length ? "mt-[22px]" : ""}`}>
              Earlier
            </div>
            <div className="flex flex-col gap-0.5">
              {earlier.map((file) => (
                <FileRow key={file.id} file={file} haptics={haptics} onOpen={() => onOpenChat(file.chatId)} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
