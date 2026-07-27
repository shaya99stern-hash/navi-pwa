"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AttachmentMeta, NaviPreferences, NaviStreamStatus, StoredChat } from "@/lib/ai/types";
import { DEFAULT_PREFERENCES, MODEL_PRESETS, chatPreview, chatTitle, createId, messageText, sortChats } from "@/lib/chat";
import { clearLocalState, loadLocalState, setLocalValue } from "@/lib/storage/indexeddb";
import { haptic } from "@/lib/ui/haptics";
import { ComposerDock } from "./composer-dock";
import { HistoryDrawer } from "./history-drawer";
import { MessageRow } from "./message-row";
import { UnifiedTopMenu } from "./unified-top-menu";

const MAX_CHATS = 40;
const MAX_MESSAGES = 60;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf"
]);

function compactSummary(messages: UIMessage[]): string {
  if (messages.length <= 14) return "";
  return messages
    .slice(0, -12)
    .map((message) => `${message.role === "user" ? "User" : "Navi"}: ${messageText(message).slice(0, 700)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n")
    .slice(-8_000);
}

function fileToPart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve({
      type: "file",
      mediaType: file.type || "application/octet-stream",
      filename: file.name,
      url: String(reader.result)
    } as FileUIPart);
    reader.readAsDataURL(file);
  });
}

function resolvedTheme(preference: NaviPreferences["theme"]): "dark" | "light" {
  if (preference === "dark" || preference === "light") return preference;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function AppShell() {
  const initialChatId = useRef(createId());
  const [activeId, setActiveId] = useState(initialChatId.current);
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [preferences, setPreferences] = useState<NaviPreferences>(DEFAULT_PREFERENCES);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [scrolled, setScrolled] = useState(false);
  const [streamStatus, setStreamStatus] = useState<NaviStreamStatus | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const edgeStart = useRef<{ x: number; y: number } | null>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
    setMessages
  } = useChat({
    transport,
    experimental_throttle: 32,
    onData: (part) => {
      if (part.type === "data-status") setStreamStatus(part.data as NaviStreamStatus);
    },
    onFinish: ({ isError, isAbort }) => {
      if (!isError && !isAbort) {
        setStreamStatus({ stage: "complete", detail: "Response complete." });
        haptic("success", preferences.haptics);
      }
    },
    onError: (chatError) => {
      console.error("Navi chat error:", chatError);
      setStreamStatus(null);
      haptic("error", preferences.haptics);
    }
  });

  const generating = status === "submitted" || status === "streaming";
  const activeChat = chats.find((chat) => chat.id === activeId);
  const activePreset = MODEL_PRESETS.find((item) => item.id === preferences.preset) ?? MODEL_PRESETS[0];
  const statusText = streamStatus?.detail ?? (generating ? "Navi is working" : activePreset.label);

  useEffect(() => {
    let cancelled = false;
    void loadLocalState()
      .then((state) => {
        if (cancelled) return;
        setChats(state.chats);
        setPreferences(state.preferences);
        setDraft(state.draft);
        if (state.chats[0]) {
          setActiveId(state.chats[0].id);
          setMessages(state.chats[0].messages);
        }
      })
      .catch((storageError) => console.error("Navi local-state restore failed:", storageError))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  useEffect(() => {
    const apply = () => {
      const next = resolvedTheme(preferences.theme);
      setTheme(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("navi.theme.v3", next);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = preferences.motion;
  }, [preferences.motion]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void setLocalValue("preferences", preferences), 180);
    return () => window.clearTimeout(timer);
  }, [hydrated, preferences]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void setLocalValue("draft", draft), 220);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated]);

  useEffect(() => {
    if (!hydrated || !preferences.saveHistory || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      setChats((current) => {
        const prior = current.find((chat) => chat.id === activeId);
        const nextChat: StoredChat = {
          id: activeId,
          title: prior?.title && prior.title !== "New chat" ? prior.title : chatTitle(messages),
          preview: chatPreview(messages),
          updatedAt: Date.now(),
          pinned: prior?.pinned ?? false,
          summary: compactSummary(messages),
          attachments: prior?.attachments,
          messages: messages.slice(-MAX_MESSAGES)
        };
        const next = sortChats([nextChat, ...current.filter((chat) => chat.id !== activeId)]).slice(0, MAX_CHATS);
        void setLocalValue("chats", next);
        return next;
      });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [activeId, hydrated, messages, preferences.saveHistory]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180;
      if (nearBottom || generating) {
        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: status === "streaming" ? "auto" : "smooth"
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [generating, messages, status, streamStatus]);

  const updatePreferences = useCallback((next: NaviPreferences) => {
    setPreferences(next);
  }, []);

  const newChat = useCallback(() => {
    if (generating) stop();
    setActiveId(createId());
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setAttachmentError(null);
    setStreamStatus(null);
    clearError();
    setHistoryOpen(false);
    setMenuOpen(false);
  }, [clearError, generating, setMessages, stop]);

  const openChat = useCallback((chat: StoredChat) => {
    if (generating) stop();
    setActiveId(chat.id);
    setMessages(chat.messages);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    clearError();
    setHistoryOpen(false);
  }, [clearError, generating, setMessages, stop]);

  function mutateChats(mutator: (current: StoredChat[]) => StoredChat[]) {
    setChats((current) => {
      const next = sortChats(mutator(current));
      void setLocalValue("chats", next);
      return next;
    });
  }

  function renameChat(id: string, title: string) {
    mutateChats((current) => current.map((chat) => chat.id === id ? { ...chat, title } : chat));
  }

  function pinChat(id: string, pinned: boolean) {
    mutateChats((current) => current.map((chat) => chat.id === id ? { ...chat, pinned } : chat));
  }

  function deleteChat(id: string) {
    mutateChats((current) => current.filter((chat) => chat.id !== id));
    if (activeId === id) newChat();
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const combined = [...pendingFiles, ...incoming].slice(0, 6);
    let total = 0;
    for (const file of combined) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setAttachmentError(`${file.name} has an unsupported file type.`);
        haptic("warning", preferences.haptics);
        return;
      }
      if (file.size > 6_000_000) {
        setAttachmentError(`${file.name} exceeds the 6 MB attachment limit.`);
        haptic("warning", preferences.haptics);
        return;
      }
      total += file.size;
    }
    if (total > 10_000_000) {
      setAttachmentError("Combined attachments exceed the 10 MB request limit.");
      haptic("warning", preferences.haptics);
      return;
    }
    setPendingFiles(combined);
    setAttachmentError(incoming.length + pendingFiles.length > 6 ? "Only the first six attachments were kept." : null);
    haptic("selection", preferences.haptics);
  }

  async function submit() {
    if ((!draft.trim() && pendingFiles.length === 0) || generating || !online) return;
    clearError();
    setAttachmentError(null);
    setStreamStatus({ stage: "gather", detail: "Preparing your request." });
    try {
      const files = pendingFiles.length ? await Promise.all(pendingFiles.map(fileToPart)) : undefined;
      const text = draft.trim() || "Please review the attached file or image.";
      const attachmentMeta: AttachmentMeta[] = pendingFiles.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size
      }));
      setDraft("");
      setPendingFiles([]);
      if (attachmentMeta.length) {
        mutateChats((current) => {
          const prior = current.find((chat) => chat.id === activeId);
          return prior
            ? current.map((chat) => chat.id === activeId
              ? { ...chat, attachments: [...(chat.attachments ?? []), ...attachmentMeta] }
              : chat)
            : current;
        });
      }
      await sendMessage(
        { text, files },
        {
          body: {
            preset: preferences.preset,
            style: preferences.style,
            tools: preferences.tools,
            threadSummary: activeChat?.summary ?? compactSummary(messages),
            connectedMcpServers: preferences.connectedMcpServers
          }
        }
      );
    } catch (submitError) {
      setAttachmentError(submitError instanceof Error ? submitError.message : "Could not prepare attachments.");
      setStreamStatus(null);
      haptic("error", preferences.haptics);
    }
  }

  function retry() {
    clearError();
    void regenerate({
      body: {
        preset: preferences.preset,
        style: preferences.style,
        tools: preferences.tools,
        threadSummary: activeChat?.summary ?? compactSummary(messages),
        connectedMcpServers: preferences.connectedMcpServers
      }
    });
  }

  function clearThread() {
    if (generating) stop();
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    clearError();
    mutateChats((current) => current.filter((chat) => chat.id !== activeId));
    setActiveId(createId());
  }

  async function clearData() {
    if (generating) stop();
    await clearLocalState();
    localStorage.removeItem("navi.chats.v2");
    localStorage.removeItem("navi.preferences.v2");
    setChats([]);
    setPreferences(DEFAULT_PREFERENCES);
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    setActiveId(createId());
  }

  function pointerDown(event: ReactPointerEvent) {
    if (event.clientX <= 26) edgeStart.current = { x: event.clientX, y: event.clientY };
  }

  function pointerUp(event: ReactPointerEvent) {
    const start = edgeStart.current;
    edgeStart.current = null;
    if (!start) return;
    if (event.clientX - start.x > 62 && Math.abs(event.clientY - start.y) < 70) {
      setHistoryOpen(true);
    }
  }

  return (
    <div
      data-app-shell="true"
      data-viewport="chat"
      className={`${preferences.density === "compact" ? "density-compact" : "density-comfortable"} relative flex flex-col bg-app text-primary`}
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
    >
      <HistoryDrawer
        open={historyOpen}
        chats={chats}
        activeId={activeId}
        haptics={preferences.haptics}
        onClose={() => setHistoryOpen(false)}
        onNew={newChat}
        onOpen={openChat}
        onRename={renameChat}
        onPin={pinChat}
        onDelete={deleteChat}
      />

      <header className="navi-header relative z-50 flex shrink-0 items-center gap-2" data-scrolled={String(scrolled)}>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
          aria-label="Open conversation history"
        >
          <Menu size={21} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px]/6 font-semibold tracking-[-0.01em] text-primary">{activeChat?.title ?? "Navi"}</div>
          {activeChat ? <div className="truncate text-[11px]/[14px] font-semibold text-tertiary">Local thread</div> : null}
        </div>
        <UnifiedTopMenu
          open={menuOpen}
          preferences={preferences}
          pendingFiles={pendingFiles}
          onToggle={() => setMenuOpen((value) => !value)}
          onClose={() => setMenuOpen(false)}
          onPreferences={updatePreferences}
          onOpenHistory={() => setHistoryOpen(true)}
          onFiles={addFiles}
          onClearFiles={() => setPendingFiles([])}
          onClearThread={clearThread}
          onClearData={() => void clearData()}
        />
      </header>

      <main
        ref={scrollRef}
        data-scroll-region="true"
        className="min-h-0 flex-1"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 3)}
      >
        {messages.length === 0 ? (
          <div className="navi-launch flex min-h-full flex-col items-center justify-center px-4 pb-24 pt-8">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--border-subtle)] bg-elev-2 text-[26px] font-semibold tracking-[-0.08em] text-primary shadow-menu">N</div>
            <h1 className="text-center text-2xl/[30px] font-semibold text-primary">What can I help with?</h1>
            <p className="mt-2 max-w-sm text-center text-[13px]/[18px] font-medium text-tertiary">Use the Navi menu for models, tools, files, connections and settings.</p>
            <div className="mt-7 grid w-full max-w-md gap-2">
              {["Plan a complex project", "Explain and compare an idea", "Create a secure interactive artifact"].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={!online}
                  onClick={() => setDraft(prompt)}
                  className="min-h-12 rounded-2xl border border-[var(--border-subtle)] bg-elev-1 px-4 text-left text-[15px]/[22px] font-medium text-secondary active:bg-elev-2 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[760px] px-4 py-5">
            <div className="message-stack flex flex-col">
              {messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  streaming={message.role === "assistant" && index === messages.length - 1 && status === "streaming"}
                  theme={theme}
                  haptics={preferences.haptics}
                />
              ))}
            </div>
            {status === "submitted" || (streamStatus && generating) ? (
              <div className="mt-3 flex min-h-10 items-center gap-2 text-[12px]/4 font-medium text-tertiary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                {statusText}
              </div>
            ) : null}
            {error ? (
              <div className="mt-4 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-4">
                <p className="text-[13px]/[18px] font-medium text-primary">{error.message || "Navi could not complete that response."}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={retry} className="min-h-10 rounded-xl bg-accent px-4 text-[13px]/[18px] font-semibold text-white active:bg-accent-pressed">Try again</button>
                  <button type="button" onClick={clearError} className="min-h-10 rounded-xl px-4 text-[13px]/[18px] font-semibold text-secondary active:bg-elev-3">Dismiss</button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      {attachmentError ? (
        <div className="mx-4 mb-1 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 px-3 py-2 text-center text-[12px]/4 font-medium text-warning">{attachmentError}</div>
      ) : null}
      <ComposerDock
        value={draft}
        generating={generating}
        online={online}
        attachmentCount={pendingFiles.length}
        statusText={statusText}
        haptics={preferences.haptics}
        onChange={setDraft}
        onSend={() => void submit()}
        onStop={() => {
          stop();
          setStreamStatus(null);
        }}
      />
    </div>
  );
}
