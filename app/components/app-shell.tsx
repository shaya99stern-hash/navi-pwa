"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { ChevronDown, FolderKanban, Link2, PanelLeft, Search, SquarePen, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { AttachmentMeta, NaviPreferences, NaviProject, NaviStreamStatus, StoredChat } from "@/lib/ai/types";
import { DEFAULT_PREFERENCES, MODEL_PRESETS, chatPreview, chatTitle, createId, messageText, sortChats } from "@/lib/chat";
import { clearLocalState, loadLocalState, setLocalValue } from "@/lib/storage/indexeddb";
import { haptic } from "@/lib/ui/haptics";
import { persistThemeCookie } from "@/lib/ui/theme-cookie";
import { ComposerDock } from "./composer-dock";
import { ConnectorsSheet } from "./connectors-sheet";
import { ConversationStatePanel } from "./conversation-state-panel";
import { HistoryDrawer } from "./history-drawer";
import { LaunchSurface } from "./launch-surface";
import { ProviderSetupNotice } from "./provider-setup-notice";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageRow } from "./message-row";
import { ProjectsSheet } from "./projects-sheet";
import { PwaPlatformBanner } from "./pwa-platform-banner";
import { UnifiedTopMenu } from "./unified-top-menu";
import { VoiceModeSheet } from "./voice-mode-sheet";

const EDGE_SWIPE_WIDTH = 300;
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

function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function AppShell({
  initialChatId,
  initialDraft,
  initialView = "chat"
}: {
  initialChatId?: string;
  initialDraft?: string;
  initialView?: "chat" | "voice";
} = {}) {
  const router = useRouter();
  const initialChatRef = useRef(initialChatId ?? createId());
  const [activeId, setActiveId] = useState(initialChatRef.current);
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [projects, setProjects] = useState<NaviProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NaviPreferences>(DEFAULT_PREFERENCES);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(initialView === "voice");
  const [speakNextReply, setSpeakNextReply] = useState(false);
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [scrolled, setScrolled] = useState(false);
  const [streamStatus, setStreamStatus] = useState<NaviStreamStatus | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [contextMessage, setContextMessage] = useState<{ id: string; text: string; role: string } | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [edgeProgress, setEdgeProgress] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchoredUserId = useRef<string | null>(null);
  const anchorTop = useRef(0);
  const edgeStart = useRef<{ x: number; y: number } | null>(null);
  const priorAssistantId = useRef<string | null>(null);

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
      if (isAbort) {
        setStreamStatus({ stage: "interrupted", detail: "You stopped this response." });
        return;
      }
      if (isError) {
        setStreamStatus({ stage: "error", detail: "Navi could not finish the response." });
        return;
      }
      setStreamStatus({ stage: "complete", detail: "Response complete." });
      haptic("success", preferences.haptics);
    },
    onError: (chatError) => {
      console.error("Navi chat error:", chatError);
      setStreamStatus({ stage: "error", detail: chatError.message || "Navi could not finish the response." });
      haptic("error", preferences.haptics);
    }
  });

  const generating = status === "submitted" || status === "streaming";
  const activeChat = chats.find((chat) => chat.id === activeId);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activePreset = MODEL_PRESETS.find((item) => item.id === preferences.preset) ?? MODEL_PRESETS[0];
  const connectorMode = activeChat?.connectorAccessMode ?? preferences.connectorAccessMode;
  const statusText = streamStatus?.detail ?? (generating ? "Navi is working" : activePreset.label);

  const requestBody = useCallback(() => ({
    preset: preferences.preset,
    style: preferences.style,
    tools: preferences.tools,
    threadSummary: activeChat?.summary ?? compactSummary(messages),
    connectedMcpServers: preferences.connectedMcpServers,
    connectorAccessMode: activeChat?.connectorAccessMode ?? preferences.connectorAccessMode,
    projectContext: activeProject ? {
      id: activeProject.id,
      name: activeProject.name,
      instructions: activeProject.instructions,
      knowledge: activeProject.knowledge
    } : undefined
  }), [activeChat?.connectorAccessMode, activeChat?.summary, activeProject, messages, preferences]);

  useEffect(() => {
    let cancelled = false;
    void loadLocalState()
      .then((state) => {
        if (cancelled) return;
        setChats(state.chats);
        setProjects(state.projects);
        setActiveProjectId(state.activeProjectId);
        setPreferences(state.preferences);
        setDraft(initialDraft ?? state.draft);
        const requestedChat = initialChatId
          ? state.chats.find((chat) => chat.id === initialChatId)
          : undefined;
        if (requestedChat) {
          setActiveId(requestedChat.id);
          setActiveProjectId(requestedChat.projectId ?? state.activeProjectId);
          setMessages(requestedChat.messages);
        } else {
          setActiveId(initialChatRef.current);
          setMessages([]);
        }
      })
      .catch((storageError) => console.error("Navi local-state restore failed:", storageError))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialChatId, initialDraft, setMessages]);

  useEffect(() => {
    const apply = () => {
      const next = resolvedTheme(preferences.theme);
      setTheme(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("navi.theme.v3", next);
      persistThemeCookie(next);
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
    if (!hydrated) return;
    const timer = window.setTimeout(() => void Promise.all([
      setLocalValue("projects", projects),
      setLocalValue("activeProjectId", activeProjectId)
    ]), 220);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, hydrated, projects]);

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
          projectId: activeProjectId ?? undefined,
          connectorAccessMode: prior?.connectorAccessMode ?? preferences.connectorAccessMode,
          messages: messages.slice(-MAX_MESSAGES)
        };
        const next = sortChats([nextChat, ...current.filter((chat) => chat.id !== activeId)]).slice(0, MAX_CHATS);
        void setLocalValue("chats", next);
        return next;
      });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [activeId, activeProjectId, hydrated, messages, preferences.connectorAccessMode, preferences.saveHistory]);

  /* Sending pins the new user message near the top so the reply has room to
     stream in beneath it, matching the native app. Scrolling up during a
     response stops the follow until the reader returns to the bottom. */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser || lastUser.id === anchoredUserId.current) return;
    anchoredUserId.current = lastUser.id;
    setAutoFollow(true);
    const frame = requestAnimationFrame(() => {
      const node = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(lastUser.id)}"]`);
      if (!node) return;
      const top = Math.max(0, node.offsetTop - 12);
      anchorTop.current = top;
      scroller.scrollTo({ top, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !autoFollow) return;
    const frame = requestAnimationFrame(() => {
      const bottom = scroller.scrollHeight - scroller.clientHeight;
      // While the reply still fits under the anchored message, following the
      // bottom would scroll the question back off the top of the screen.
      if (bottom < anchorTop.current) return;
      scroller.scrollTo({ top: bottom, behavior: status === "streaming" ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFollow, generating, messages, status, streamStatus]);

  /* The keyboard shrinks the shell, which would otherwise slide the newest
     message behind the composer. Re-anchor to the bottom as it opens so the
     conversation keeps its place, the way a native thread does. */
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (root.dataset.keyboardOpen !== "true" || !autoFollow) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" }));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-keyboard-open"] });
    return () => observer.disconnect();
  }, [autoFollow]);

  /* A light tick when the first token lands, so the reply announces itself
     without needing to be looked at. */
  useEffect(() => {
    if (status === "streaming") haptic("selection", preferences.haptics);
  }, [preferences.haptics, status]);

  useEffect(() => {
    if (!speakNextReply || generating || !("speechSynthesis" in window)) return;
    const latest = [...messages].reverse().find((message) => message.role === "assistant" && messageText(message));
    if (!latest || latest.id === priorAssistantId.current) return;
    const text = messageText(latest).replace(/```[\s\S]*?```/g, " Code or generated content is available on screen. ").slice(0, 4_000);
    if (!text) return;
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = localStorage.getItem("navi.voice.language.v1") || navigator.language || "en-US";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
    priorAssistantId.current = latest.id;
    setSpeakNextReply(false);
  }, [generating, messages, speakNextReply]);

  useEffect(() => () => stopSpeaking(), []);

  const updatePreferences = useCallback((next: NaviPreferences) => {
    setPreferences(next);
    setChats((current) => current.map((chat) => chat.id === activeId
      ? { ...chat, connectorAccessMode: next.connectorAccessMode }
      : chat));
  }, [activeId]);

  const newChat = useCallback(() => {
    if (generating) stop();
    stopSpeaking();
    setVoiceOpen(false);
    setSpeakNextReply(false);
    setActiveId(createId());
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setAttachmentError(null);
    setStreamStatus(null);
    clearError();
    setHistoryOpen(false);
    setMenuOpen(false);
    router.push("/new");
  }, [clearError, generating, router, setMessages, stop]);

  const openChat = useCallback((chat: StoredChat) => {
    if (generating) stop();
    stopSpeaking();
    setVoiceOpen(false);
    setSpeakNextReply(false);
    setActiveId(chat.id);
    setActiveProjectId(chat.projectId ?? null);
    setMessages(chat.messages);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    clearError();
    setHistoryOpen(false);
    router.push(`/chat/${encodeURIComponent(chat.id)}`);
  }, [clearError, generating, router, setMessages, stop]);

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

  function addProject(project: NaviProject) {
    setProjects((current) => [project, ...current]);
  }

  function updateProject(project: NaviProject) {
    setProjects((current) => current.map((item) => item.id === project.id ? project : item).sort((a, b) => b.updatedAt - a.updatedAt));
  }

  function deleteProject(id: string) {
    setProjects((current) => current.filter((project) => project.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
    mutateChats((current) => current.map((chat) => chat.projectId === id ? { ...chat, projectId: undefined } : chat));
  }

  function selectProject(id: string | null) {
    setActiveProjectId(id);
    mutateChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, projectId: id ?? undefined } : chat));
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
    setStreamStatus({
      stage: "gather",
      detail: activeProject
        ? `Loading ${activeProject.name} project context.`
        : preferences.tools.web
          ? "Starting research and gathering sources."
          : "Preparing your request."
    });
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
      if (window.location.pathname === "/" || window.location.pathname === "/new") {
        window.history.replaceState(window.history.state, "", `/chat/${encodeURIComponent(activeId)}`);
      }
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
      await sendMessage({ text, files }, { body: requestBody() });
    } catch (submitError) {
      setAttachmentError(submitError instanceof Error ? submitError.message : "Could not prepare attachments.");
      setStreamStatus({ stage: "error", detail: "Could not prepare or send this request." });
      haptic("error", preferences.haptics);
    }
  }

  async function submitVoiceTranscript(text: string, speakReply: boolean) {
    if (!text.trim() || generating || !online) return;
    clearError();
    setAttachmentError(null);
    setStreamStatus({
      stage: "gather",
      detail: activeProject ? `Loading ${activeProject.name} project context.` : preferences.tools.web ? "Starting research for your spoken request." : "Preparing your spoken request."
    });
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    priorAssistantId.current = latestAssistant?.id ?? null;
    setSpeakNextReply(speakReply);
    try {
      await sendMessage({ text: text.trim() }, { body: requestBody() });
    } catch (voiceError) {
      setSpeakNextReply(false);
      setStreamStatus({
        stage: "error",
        detail: voiceError instanceof Error ? voiceError.message : "Could not send the spoken request."
      });
      haptic("error", preferences.haptics);
    }
  }

  /* Editing a question drops it and everything after it, then returns the text
     to the composer so the thread can be re-run from that point. */
  function editMessage(id: string, text: string) {
    if (generating) stop();
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) return;
    setMessages(messages.slice(0, index));
    setDraft(text);
    setStreamStatus(null);
    clearError();
    anchoredUserId.current = null;
    setAutoFollow(true);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat with Navi"]')?.focus();
    }, 60);
  }

  function retry() {
    clearError();
    setStreamStatus({
      stage: "gather",
      detail: activeProject ? `Reloading ${activeProject.name} project context.` : preferences.tools.web ? "Restarting research." : "Retrying your request."
    });
    void regenerate({ body: requestBody() });
  }

  function clearThread() {
    if (generating) stop();
    stopSpeaking();
    setVoiceOpen(false);
    setSpeakNextReply(false);
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
    stopSpeaking();
    await clearLocalState();
    localStorage.removeItem("navi.chats.v2");
    localStorage.removeItem("navi.preferences.v2");
    setChats([]);
    setProjects([]);
    setActiveProjectId(null);
    setPreferences(DEFAULT_PREFERENCES);
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    setVoiceOpen(false);
    setSpeakNextReply(false);
    setActiveId(createId());
  }

  /* The sidebar follows the thumb from the left edge rather than snapping open
     at a threshold. A mostly-vertical drag is a scroll, so it cancels. */
  function pointerDown(event: ReactPointerEvent) {
    if (historyOpen || event.clientX > 26) return;
    edgeStart.current = { x: event.clientX, y: event.clientY };
  }

  function pointerMove(event: ReactPointerEvent) {
    const start = edgeStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = Math.abs(event.clientY - start.y);
    if (dy > Math.abs(dx) && dy > 12) {
      edgeStart.current = null;
      setEdgeProgress(null);
      return;
    }
    if (dx <= 0) return;
    setEdgeProgress(Math.min(1, dx / EDGE_SWIPE_WIDTH));
  }

  function pointerUp(event: ReactPointerEvent) {
    const start = edgeStart.current;
    edgeStart.current = null;
    if (edgeProgress !== null) {
      const opened = edgeProgress > 0.35;
      setEdgeProgress(null);
      if (opened) {
        haptic("impact-light", preferences.haptics);
        setHistoryOpen(true);
      }
      return;
    }
    if (!start) return;
    if (event.clientX - start.x > 62 && Math.abs(event.clientY - start.y) < 70) {
      setHistoryOpen(true);
    }
  }

  function toggleResearch() {
    const enabled = !preferences.tools.web;
    updatePreferences({
      ...preferences,
      tools: { ...preferences.tools, web: enabled }
    });
    setStreamStatus(null);
    haptic("selection", preferences.haptics);
  }

  return (
    <div
      data-app-shell="true"
      data-viewport="chat"
      className={`${preferences.density === "compact" ? "density-compact" : "density-comfortable"} relative flex flex-col bg-app text-primary`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <HistoryDrawer
        open={historyOpen}
        dragProgress={edgeProgress}
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

      <header className="navi-header relative z-50 flex shrink-0 items-center gap-0.5" data-scrolled={String(scrolled)}>
        <button
          type="button"
          onClick={() => {
            haptic("impact-light", preferences.haptics);
            setHistoryOpen(true);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-elev-2"
          aria-label="Open sidebar"
        >
          <PanelLeft size={21} strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          {messages.length === 0 && !activeChat ? (
            <div className="font-display truncate text-[19px]/6 tracking-[-0.01em] text-primary">NaviOS Hub</div>
          ) : (
            <>
              <div className="truncate px-1 text-[16px]/5 font-medium tracking-[-0.01em] text-primary">{activeChat?.title ?? "New chat"}</div>
              {/* Only a project earns a subtitle; the model is already shown on
                  the composer chip, and repeating it here is not what the
                  native app does. */}
              {activeProject ? (
                <div className="truncate text-[11px]/[14px] font-medium text-tertiary">{activeProject.name}</div>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={newChat}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-elev-2"
          aria-label="New chat"
        >
          <SquarePen size={20} strokeWidth={1.8} />
        </button>
        <UnifiedTopMenu
          open={menuOpen}
          preferences={preferences}
          pendingFiles={pendingFiles}
          onToggle={() => setMenuOpen((value) => !value)}
          onClose={() => setMenuOpen(false)}
          onPreferences={updatePreferences}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenProjects={() => { setMenuOpen(false); setProjectsOpen(true); }}
          onOpenConnectors={() => { setMenuOpen(false); setConnectorsOpen(true); }}
          onFiles={addFiles}
          onClearFiles={() => setPendingFiles([])}
          onClearThread={clearThread}
          onClearData={() => void clearData()}
        />
      </header>

      {!online ? (
        <div className="offline-banner flex min-h-10 items-center justify-center gap-2 border-y border-[var(--accent-warning)] bg-elev-2 px-4 text-center text-[12px]/4 font-semibold text-warning" role="status">
          <WifiOff size={15} />
          Offline · chats, projects, and drafts remain available locally
        </div>
      ) : activeProject ? (
        <button type="button" onClick={() => setProjectsOpen(true)} className="flex min-h-9 items-center justify-center gap-2 border-y border-accent bg-[var(--selection-bg)] px-4 text-center text-[11px]/4 font-semibold text-accent active:bg-elev-2">
          <FolderKanban size={14} />
          Project: {activeProject.name} · {activeProject.knowledge.length} knowledge item{activeProject.knowledge.length === 1 ? "" : "s"}
        </button>
      ) : preferences.tools.web ? (
        <div className="flex min-h-9 items-center justify-center gap-2 border-y border-accent bg-[var(--selection-bg)] px-4 text-center text-[11px]/4 font-semibold text-accent" role="status">
          <Search size={14} />
          Research mode on · Navi will use available web or connected sources
        </div>
      ) : preferences.connectedMcpServers.length ? (
        <button type="button" onClick={() => setConnectorsOpen(true)} className="flex min-h-9 items-center justify-center gap-2 border-y border-[var(--border-subtle)] bg-elev-2 px-4 text-center text-[11px]/4 font-semibold text-secondary active:bg-elev-3">
          <Link2 size={14} />
          {preferences.connectedMcpServers.length} connector{preferences.connectedMcpServers.length === 1 ? "" : "s"} · {connectorMode}
        </button>
      ) : null}

      <main
        ref={scrollRef}
        data-scroll-region="true"
        className="min-h-0 flex-1"
        onScroll={(event) => {
          const el = event.currentTarget;
          setScrolled(el.scrollTop > 3);
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          const bottom = distanceFromBottom < 90;
          setAtBottom(bottom);
          // Reading back through a response takes precedence over following it.
          setAutoFollow(bottom);
        }}
      >
        {messages.length === 0 && !hydrated && initialChatId ? (
          /* Restoring a saved chat: without this the greeting flashes for a
             frame before the stored messages arrive from IndexedDB. */
          <div className="mx-auto w-full max-w-app px-gutter py-5" aria-hidden="true">
            <div className="message-stack flex flex-col">
              <div className="flex justify-end"><div className="skeleton-line h-11 w-[62%] rounded-[18px]" /></div>
              <div className="w-full space-y-2">
                <div className="skeleton-line h-4 w-[94%] rounded-md" />
                <div className="skeleton-line h-4 w-[88%] rounded-md" />
                <div className="skeleton-line h-4 w-[70%] rounded-md" />
              </div>
              <div className="flex justify-end"><div className="skeleton-line h-11 w-[45%] rounded-[18px]" /></div>
              <div className="w-full space-y-2">
                <div className="skeleton-line h-4 w-[90%] rounded-md" />
                <div className="skeleton-line h-4 w-[64%] rounded-md" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <LaunchSurface online={online}>
            <ProviderSetupNotice haptics={preferences.haptics} />
          </LaunchSurface>
        ) : (
          <div className="mx-auto w-full max-w-app px-gutter py-5">
            <div className="message-stack flex flex-col">
              {messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  streaming={message.role === "assistant" && index === messages.length - 1 && status === "streaming"}
                  theme={theme}
                  haptics={preferences.haptics}
                  onRetry={message.role === "assistant" && index === messages.length - 1 && !generating && online ? retry : undefined}
                  onLongPress={setContextMessage}
                />
              ))}
            </div>
            <ConversationStatePanel
              research={preferences.tools.web}
              generating={generating}
              status={streamStatus}
            />
            {error ? (
              <div className="mt-4 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-4" role="alert">
                <p className="text-[13px]/[18px] font-medium text-primary">{error.message || "Navi could not complete that response."}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={retry} className="min-h-11 rounded-xl bg-accent px-4 text-[13px]/[18px] font-semibold text-white active:bg-accent-pressed">Try again</button>
                  <button type="button" onClick={clearError} className="min-h-11 rounded-xl px-4 text-[13px]/[18px] font-semibold text-secondary active:bg-elev-3">Dismiss</button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      {messages.length > 0 && !atBottom ? (
        <button
          type="button"
          onClick={() => {
            const scroller = scrollRef.current;
            if (!scroller) return;
            haptic("selection", preferences.haptics);
            setAutoFollow(true);
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
          }}
          className="scroll-to-bottom absolute left-1/2 z-30 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-elev-2 text-secondary shadow-sheet active:scale-95"
          aria-label="Scroll to latest"
        >
          <ChevronDown size={18} />
        </button>
      ) : null}

      {attachmentError ? (
        <div className="mx-4 mb-1 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 px-3 py-2 text-center text-[12px]/4 font-medium text-warning" role="alert">{attachmentError}</div>
      ) : null}
      <div className="shrink-0 px-gutter">
        <PwaPlatformBanner inline />
      </div>
      <ComposerDock
        value={draft}
        generating={generating}
        online={online}
        attachmentCount={pendingFiles.length}
        modelLabel={activePreset.label}
        research={preferences.tools.web}
        statusText={activeProject ? `${activeProject.name} · ${statusText}` : statusText}
        haptics={preferences.haptics}
        onChange={setDraft}
        onSend={() => void submit()}
        onFiles={addFiles}
        onOpenModels={() => {
          updatePreferences({ ...preferences, lastMenuSection: "models" });
          setMenuOpen(true);
        }}
        onOpenVoice={() => {
          setMenuOpen(false);
          setVoiceOpen(true);
          haptic("selection", preferences.haptics);
        }}
        onToggleResearch={toggleResearch}
        onOpenTools={() => {
          updatePreferences({ ...preferences, lastMenuSection: "tools" });
          setMenuOpen(true);
        }}
        onStop={() => {
          stop();
          setStreamStatus({ stage: "interrupted", detail: "You stopped this response." });
        }}
      />

      {contextMessage ? (
        <MessageActionSheet
          text={contextMessage.text}
          canRetry={!generating && online}
          canEdit={contextMessage.role === "user" && !generating}
          haptics={preferences.haptics}
          onClose={() => setContextMessage(null)}
          onRetry={retry}
          onEdit={() => editMessage(contextMessage.id, contextMessage.text)}
        />
      ) : null}

      <VoiceModeSheet
        open={voiceOpen}
        busy={generating}
        online={online}
        haptics={preferences.haptics}
        onClose={() => setVoiceOpen(false)}
        onUseTranscript={(text) => setDraft((current) => `${current}${current.trim() ? " " : ""}${text}`)}
        onSendTranscript={(text, speakReply) => void submitVoiceTranscript(text, speakReply)}
      />

      <ProjectsSheet
        open={projectsOpen}
        projects={projects}
        activeProjectId={activeProjectId}
        chats={chats}
        haptics={preferences.haptics}
        onClose={() => setProjectsOpen(false)}
        onCreate={addProject}
        onUpdate={updateProject}
        onDelete={deleteProject}
        onSelect={selectProject}
      />

      <ConnectorsSheet
        open={connectorsOpen}
        preferences={preferences}
        haptics={preferences.haptics}
        onClose={() => setConnectorsOpen(false)}
        onPreferences={updatePreferences}
      />
    </div>
  );
}
