"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { ChevronDown, Ellipsis, FolderKanban, Ghost, Link2, PanelLeft, Search, SquarePen, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { AttachmentMeta, MenuSection, NaviPreferences, NaviProject, NaviStreamStatus, StoredChat } from "@/lib/ai/types";
import {
  ATTACHMENT_BUDGET,
  MAX_ATTACHMENTS,
  MAX_IMAGE_INPUT_BYTES,
  isResizableImage,
  prepareAttachments
} from "@/lib/ui/attachments";
import { DEFAULT_PREFERENCES, EFFORT_LEVELS, MODEL_PRESETS, chatPreview, chatTitle, createId, messageText, sortChats } from "@/lib/chat";
import {
  clearLocalState,
  loadLocalState,
  requestPersistentStorage,
  setLocalValue,
  type StorageDurability
} from "@/lib/storage/indexeddb";
import { memoryBlock, recall } from "@/lib/memory";
import { BUILT_IN_PLAYBOOKS, playbookBlock, selectPlaybook, type Playbook } from "@/lib/playbooks";
import { instantAnswer, parseSlashCommand, runSlash } from "@/lib/skills";
import { haptic } from "@/lib/ui/haptics";
import { speak, whenVoicesReady } from "@/lib/ui/speech";
import { useEdgeSwipe } from "@/lib/ui/use-edge-swipe";
import { persistThemeCookie } from "@/lib/ui/theme-cookie";
import { ComposerDock } from "./composer-dock";
import { ConnectorsSheet } from "./connectors-sheet";
import { ConversationStatePanel } from "./conversation-state-panel";
import { HistoryDrawer } from "./history-drawer";
import { LaunchSurface } from "./launch-surface";
import { ProviderSetupNotice } from "./provider-setup-notice";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageRow } from "./message-row";
import { ArtifactsSheet } from "./artifacts-sheet";
import { ChatMenuSheet } from "./chat-menu-sheet";
import { ModelPickerSheet } from "./model-picker-sheet";
import { ProjectsSheet } from "./projects-sheet";
import { PwaPlatformBanner } from "./pwa-platform-banner";
import { SettingsSheet } from "./settings-sheet";
import { VoiceModeSheet } from "./voice-mode-sheet";

const MAX_CHATS = 40;
/** Quiet period before a save, and the longest a save may ever be put off. */
const PERSIST_DEBOUNCE = 360;
const MAX_PERSIST_DEFER = 1_500;
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

/** Total characters of older conversation carried alongside the live messages. */
const SUMMARY_BUDGET = 8_000;
/** Turns kept verbatim from the start of the thread. */
const OPENING_TURNS = 6;
/** Share of the budget reserved for those opening turns. */
const OPENING_SHARE = 0.35;

/**
 * Condense the messages that fall outside the live window.
 *
 * Keeping only the most recent characters — which is what a plain trailing
 * slice does — drops the beginning of the conversation first. That is where
 * the task, the constraints, and any "always do X" instruction were stated, so
 * a long thread would lose its own premise while remembering small talk. Keep
 * both ends and drop the middle instead.
 */
function compactSummary(messages: UIMessage[]): string {
  if (messages.length <= 14) return "";
  const lines = messages
    .slice(0, -12)
    .map((message) => `${message.role === "user" ? "User" : "Navi"}: ${messageText(message).slice(0, 700)}`)
    .filter((line) => !line.endsWith(": "));
  if (!lines.length) return "";

  const whole = lines.join("\n");
  if (whole.length <= SUMMARY_BUDGET) return whole;

  const openingBudget = Math.floor(SUMMARY_BUDGET * OPENING_SHARE);
  const opening = lines.slice(0, OPENING_TURNS).join("\n").slice(0, openingBudget);
  const recent = lines.slice(OPENING_TURNS).join("\n").slice(-(SUMMARY_BUDGET - openingBudget));
  return `${opening}\n\n[…earlier middle of this conversation omitted…]\n\n${recent}`;
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

/** Which layer a deep link should open over the chat, rather than navigating. */
export type InitialSheet = "history" | "projects" | "artifacts" | "connectors" | "settings" | "customize";

export function AppShell({
  initialChatId,
  initialDraft,
  initialView = "chat",
  initialSheet
}: {
  initialChatId?: string;
  initialDraft?: string;
  initialView?: "chat" | "voice";
  initialSheet?: InitialSheet;
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
  const [durability, setDurability] = useState<StorageDurability>("unavailable");
  const [settingsOpen, setSettingsOpen] = useState(initialSheet === "settings" || initialSheet === "customize");
  // /settings lands on the root list; /customize lands inside the Customize
  // group, whose first page is Skills.
  const [settingsSection, setSettingsSection] = useState<MenuSection | undefined>(
    initialSheet === "customize" ? "skills" : undefined
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  /* Incognito: this conversation is never written to storage and never
     recalled by memory. It exists only while the screen is open. */
  const [incognito, setIncognito] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(initialSheet === "history");
  const [projectsOpen, setProjectsOpen] = useState(initialSheet === "projects");
  const [connectorsOpen, setConnectorsOpen] = useState(initialSheet === "connectors");
  const [artifactsOpen, setArtifactsOpen] = useState(initialSheet === "artifacts");
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPersistAt = useRef(0);
  const anchoredUserId = useRef<string | null>(null);
  const anchorTop = useRef(0);
  const priorAssistantId = useRef<string | null>(null);

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const edgeSwipe = useEdgeSwipe({ disabled: historyOpen, haptics: preferences.haptics, onOpen: openHistory });

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
      // Response-completion notification, only when the tab is not being
      // looked at — with it in view the finished text is its own signal.
      if (preferences.notifyOnComplete && document.visibilityState === "hidden"
        && "Notification" in window && Notification.permission === "granted") {
        void navigator.serviceWorker?.getRegistration("/")
          .then((registration) => registration?.showNotification("NaviOS Hub", {
            body: "Navi has finished a response.",
            icon: "/pwa-icon-192-v5.png",
            badge: "/pwa-icon-192-v5.png",
            tag: "navi-response-complete"
          }))
          .catch(() => undefined);
      }
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
  const activeEffort = EFFORT_LEVELS.find((level) => level.id === preferences.effort) ?? EFFORT_LEVELS[1];
  const connectorMode = activeChat?.connectorAccessMode ?? preferences.connectorAccessMode;
  const statusText = streamStatus?.detail ?? (generating ? "Navi is working" : activePreset.label);

  /* Recall runs against the question being asked, so it is computed at send
     time rather than folded into the memoised body. */
  const recalledContext = useCallback((question: string) => {
    if (incognito || !preferences.memory || !question.trim()) return "";
    return memoryBlock(recall(question, chats, activeId));
  }, [activeId, chats, incognito, preferences.memory]);

  /* Built-ins plus anything pasted in; one is chosen per request, or none. */
  const playbooks = useMemo<Playbook[]>(() => [
    ...BUILT_IN_PLAYBOOKS,
    ...preferences.customPlaybooks.map((entry) => ({ ...entry, source: "custom" as const }))
  ], [preferences.customPlaybooks]);

  const requestBody = useCallback((question?: string) => ({
    preset: preferences.preset,
    effort: preferences.effort,
    tools: preferences.tools,
    memory: question ? recalledContext(question) : "",
    playbook: question ? playbookBlock(selectPlaybook(question, playbooks)) : "",
    threadSummary: activeChat?.summary ?? compactSummary(messages),
    connectedMcpServers: preferences.connectedMcpServers,
    connectorAccessMode: activeChat?.connectorAccessMode ?? preferences.connectorAccessMode,
    // Standing profile: name, work, and the user's own instructions travel
    // with every request so each chat starts already knowing them.
    userContext: preferences.profile.displayName || preferences.profile.fullName || preferences.profile.work || preferences.profile.instructions
      ? {
        displayName: preferences.profile.displayName || preferences.profile.fullName,
        work: preferences.profile.work,
        instructions: preferences.profile.instructions
      }
      : undefined,
    projectContext: activeProject ? {
      id: activeProject.id,
      name: activeProject.name,
      instructions: activeProject.instructions,
      knowledge: activeProject.knowledge
    } : undefined
  }), [activeChat?.connectorAccessMode, activeChat?.summary, activeProject, messages, playbooks, preferences, recalledContext]);

  useEffect(() => {
    let cancelled = false;
    void requestPersistentStorage().then((result) => {
      if (!cancelled) setDurability(result);
    });
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
    if (!hydrated || incognito || !preferences.saveHistory || messages.length === 0) return;
    // A stream rewrites `messages` every throttle tick, so a plain debounce was
    // pushed out for the whole response and never fired: backgrounding the app
    // mid-reply lost the answer *and* the question that produced it. Cap how
    // long a write can be deferred so progress always reaches the device.
    const waited = Date.now() - lastPersistAt.current;
    const delay = waited >= MAX_PERSIST_DEFER ? 0 : Math.min(PERSIST_DEBOUNCE, MAX_PERSIST_DEFER - waited);
    const timer = window.setTimeout(() => {
      lastPersistAt.current = Date.now();
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
          ratings: prior?.ratings,
          projectId: activeProjectId ?? undefined,
          connectorAccessMode: prior?.connectorAccessMode ?? preferences.connectorAccessMode,
          messages: messages.slice(-MAX_MESSAGES)
        };
        const next = sortChats([nextChat, ...current.filter((chat) => chat.id !== activeId)]).slice(0, MAX_CHATS);
        void setLocalValue("chats", next);
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeId, activeProjectId, hydrated, incognito, messages, preferences.connectorAccessMode, preferences.saveHistory]);

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

  /* CSS smooth scrolling wins over scrollTo({ behavior: "auto" }), so every
     streamed token would animate and the thread would float behind the text. */
  useEffect(() => {
    document.documentElement.dataset.streaming = generating ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.streaming;
    };
  }, [generating]);

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
    const language = localStorage.getItem("navi.voice.language.v1") || navigator.language || "en-US";
    // The voice list loads asynchronously and is usually empty on first use,
    // which is how apps end up always speaking in the default compact voice.
    whenVoicesReady(() => speak(text, language));
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
    setIncognito(false);
    setAttachmentError(null);
    setStreamStatus(null);
    clearError();
    setHistoryOpen(false);
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

  /** Thumbs feedback is stored on the chat; tapping the same thumb clears it. */
  function rateMessage(messageId: string, value: "up" | "down") {
    mutateChats((current) => current.map((chat) => {
      if (chat.id !== activeId) return chat;
      const ratings = { ...(chat.ratings ?? {}) };
      if (ratings[messageId] === value) delete ratings[messageId];
      else ratings[messageId] = value;
      return { ...chat, ratings };
    }));
  }

  function renameActiveChat() {
    const current = chats.find((chat) => chat.id === activeId);
    const title = window.prompt("Rename this chat", current?.title ?? "")?.trim();
    if (title) renameChat(activeId, title.slice(0, 80));
  }

  async function shareActiveChat() {
    const current = chats.find((chat) => chat.id === activeId);
    const transcript = messages
      .map((message) => `${message.role === "user" ? "You" : "Navi"}: ${messageText(message)}`)
      .filter((line) => !line.endsWith(": "))
      .join("\n\n");
    if (!transcript) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: current?.title ?? "Navi chat", text: transcript });
      } catch {
        // Cancelled by the user.
      }
      return;
    }
    await navigator.clipboard.writeText(transcript);
    haptic("success", preferences.haptics);
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
    const combined = [...pendingFiles, ...incoming].slice(0, MAX_ATTACHMENTS);
    for (const file of combined) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setAttachmentError(`${file.name} has an unsupported file type.`);
        haptic("warning", preferences.haptics);
        return;
      }
      // Images are resized on send, so only their decode cost is bounded here;
      // everything else has to fit the request budget as-is.
      const limit = isResizableImage(file) ? MAX_IMAGE_INPUT_BYTES : ATTACHMENT_BUDGET;
      if (file.size > limit) {
        setAttachmentError(`${file.name} is too large to send.`);
        haptic("warning", preferences.haptics);
        return;
      }
    }
    setPendingFiles(combined);
    setAttachmentError(incoming.length + pendingFiles.length > 6 ? "Only the first six attachments were kept." : null);
    haptic("selection", preferences.haptics);
  }

  /**
   * Slash commands are answered on the device: no request, no model, no
   * network, and the same answer every time. Offline is therefore not a
   * reason to refuse one, which is why this runs before the online check.
   */
  async function runSkillCommand(): Promise<boolean> {
    const invocation = parseSlashCommand(draft);
    // A question with exactly one right answer that a local function already
    // knows does not need a round trip, a network, or a model that might get
    // it wrong. Anything not recognised falls through untouched.
    const instant = invocation ? null : await instantAnswer(draft);
    if (!invocation && !instant) return false;
    clearError();
    setAttachmentError(null);
    setDraft("");
    const question: UIMessage = {
      id: createId(),
      role: "user",
      parts: [{ type: "text", text: draft.trim() }]
    };
    const answer: UIMessage = {
      id: createId(),
      role: "assistant",
      parts: [{ type: "text", text: invocation ? await runSlash(invocation) : instant!.text }]
    };
    setMessages([...messages, question, answer]);
    setStreamStatus(null);
    haptic("success", preferences.haptics);
    if (window.location.pathname === "/" || window.location.pathname === "/new") {
      window.history.replaceState(window.history.state, "", `/chat/${encodeURIComponent(activeId)}`);
    }
    return true;
  }

  async function submit() {
    if (generating) return;
    if (await runSkillCommand()) return;
    if ((!draft.trim() && pendingFiles.length === 0) || !online) return;
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
      // Resize before encoding: the Edge runtime rejects the whole request if
      // the base64 payload overruns its body cap, with no usable error.
      /* An edit that must preserve text needs the source to stay legible, so
         the usual aggressive downscale is relaxed for those requests. */
      const preserveDetail = /\b(document|paper|form|receipt|invoice|statement|spreadsheet|table|label|sign|menu|page|letter|contract|report|ticket|screenshot|text|number|numbers|digit|digits|amount|date|total|handwriting|handwritten)\b/i.test(draft)
        || /\b(?:do\s?n[o']?t|don't|never)\s+(?:change|alter|modify|touch)\b/i.test(draft)
        || /\bkeep\s+.{1,40}?\s+(?:the\s+same|unchanged|as\s+is|intact)\b/i.test(draft);
      const { files: outgoing, notice } = await prepareAttachments(pendingFiles, preserveDetail);
      if (notice) setAttachmentError(notice);
      const files = outgoing.length ? await Promise.all(outgoing.map(fileToPart)) : undefined;
      const text = draft.trim() || "Please review the attached file or image.";
      const attachmentMeta: AttachmentMeta[] = outgoing.map((file) => ({
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
      await sendMessage({ text, files }, { body: requestBody(text) });
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
      await sendMessage({ text: text.trim() }, { body: requestBody(text) });
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
    // Must run inside the tap that triggered the edit: iOS only opens the
    // keyboard for a focus() call that still carries the user-gesture token,
    // which a timeout or a post-render effect would have already lost.
    composerRef.current?.focus({ preventScroll: true });
  }

  function retry() {
    clearError();
    setStreamStatus({
      stage: "gather",
      detail: activeProject ? `Reloading ${activeProject.name} project context.` : preferences.tools.web ? "Restarting research." : "Retrying your request."
    });
    void regenerate({ body: requestBody(messageText([...messages].reverse().find((m) => m.role === "user") ?? messages[0] ?? { id: "", role: "user", parts: [] })) });
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

  function exportData() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), chats, projects, preferences }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `navi-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    haptic("success", preferences.haptics);
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
      {...edgeSwipe.handlers}
      onPointerCancel={edgeSwipe.handlers.onPointerUp}
    >
      <HistoryDrawer
        open={historyOpen}
        dragProgress={edgeSwipe.progress}
        chats={chats}
        activeId={activeId}
        profileName={preferences.profile.displayName || preferences.profile.fullName}
        haptics={preferences.haptics}
        onClose={() => setHistoryOpen(false)}
        onNew={newChat}
        onProjects={() => setProjectsOpen(true)}
        onArtifacts={() => setArtifactsOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onCustomize={() => { setSettingsSection("skills"); setSettingsOpen(true); }}
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
            <div className="font-display truncate text-[1.1875rem]/6 tracking-[-0.01em] text-primary">NaviOS Hub</div>
          ) : (
            /* The title is the chat's own menu: star, rename, share, delete.
               The chevron is the affordance that says so. */
            <button
              type="button"
              onClick={() => { haptic("selection", preferences.haptics); setChatMenuOpen(true); }}
              className="mx-auto flex min-w-0 max-w-full items-center justify-center gap-1 rounded-lg px-1 active:bg-elev-2"
              aria-label="Chat actions"
              aria-haspopup="menu"
            >
              <span className="min-w-0">
                <span className="block truncate text-[1rem]/5 font-medium tracking-[-0.01em] text-primary">{activeChat?.title ?? "New chat"}</span>
                {activeProject ? (
                  <span className="block truncate text-[0.6875rem]/[0.875rem] font-medium text-tertiary">{activeProject.name}</span>
                ) : null}
              </span>
              <ChevronDown size={14} className="shrink-0 text-tertiary" />
            </button>
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
        {incognito ? (
          <span className="flex h-11 w-8 shrink-0 items-center justify-center text-accent" title="Incognito — this chat is not saved">
            <Ghost size={19} strokeWidth={1.8} />
          </span>
        ) : null}
        {/* In a chat this position is chat context; on the launch screen there
            is no chat yet, so it opens Settings. */}
        <button
          type="button"
          onClick={() => {
            haptic("selection", preferences.haptics);
            if (messages.length > 0 && activeChat) setChatMenuOpen(true);
            else setSettingsOpen(true);
          }}
          aria-label={messages.length > 0 && activeChat ? "Chat actions" : "Settings"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-elev-2"
        >
          <Ellipsis size={21} strokeWidth={1.8} />
        </button>
      </header>

      {!online ? (
        <div className="offline-banner flex min-h-10 items-center justify-center gap-2 border-y border-[var(--accent-warning)] bg-elev-2 px-4 text-center text-[0.75rem]/4 font-semibold text-warning" role="status">
          <WifiOff size={15} />
          Offline · chats, projects, and drafts remain available locally
        </div>
      ) : activeProject ? (
        <button type="button" onClick={() => setProjectsOpen(true)} className="flex min-h-9 items-center justify-center gap-2 border-y border-accent bg-[var(--selection-bg)] px-4 text-center text-[0.6875rem]/4 font-semibold text-accent active:bg-elev-2">
          <FolderKanban size={14} />
          Project: {activeProject.name} · {activeProject.knowledge.length} knowledge item{activeProject.knowledge.length === 1 ? "" : "s"}
        </button>
      ) : preferences.tools.web ? (
        <div className="flex min-h-9 items-center justify-center gap-2 border-y border-accent bg-[var(--selection-bg)] px-4 text-center text-[0.6875rem]/4 font-semibold text-accent" role="status">
          <Search size={14} />
          Research mode on · Navi will use available web or connected sources
        </div>
      ) : preferences.connectedMcpServers.length ? (
        <button type="button" onClick={() => setConnectorsOpen(true)} className="flex min-h-9 items-center justify-center gap-2 border-y border-[var(--border-subtle)] bg-elev-2 px-4 text-center text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3">
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
                  last={message.role === "assistant" && index === messages.length - 1 && !generating}
                  theme={theme}
                  chatFont={preferences.chatFont}
                  haptics={preferences.haptics}
                  voiceLanguage={preferences.voiceLanguage}
                  rating={activeChat?.ratings?.[message.id]}
                  onRate={message.role === "assistant" ? (value) => rateMessage(message.id, value) : undefined}
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
                <p className="text-[0.8125rem]/[1.125rem] font-medium text-primary">{error.message || "Navi could not complete that response."}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={retry} className="min-h-11 rounded-xl bg-accent px-4 text-[0.8125rem]/[1.125rem] font-semibold text-white active:bg-accent-pressed">Try again</button>
                  <button type="button" onClick={clearError} className="min-h-11 rounded-xl px-4 text-[0.8125rem]/[1.125rem] font-semibold text-secondary active:bg-elev-3">Dismiss</button>
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
        <div className="mx-4 mb-1 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 px-3 py-2 text-center text-[0.75rem]/4 font-medium text-warning" role="alert">{attachmentError}</div>
      ) : null}
      <div className="shrink-0 px-gutter">
        <PwaPlatformBanner inline />
      </div>
      <ComposerDock
        inputRef={composerRef}
        offlineCommand={parseSlashCommand(draft) !== null}
        value={draft}
        generating={generating}
        online={online}
        attachmentCount={pendingFiles.length}
        modelLabel={activePreset.label}
        effortLabel={activeEffort.label}
        hasMessages={messages.length > 0}
        research={preferences.tools.web}
        statusText={activeProject ? `${activeProject.name} · ${statusText}` : statusText}
        haptics={preferences.haptics}
        connectorCount={preferences.connectedMcpServers.length}
        connectorAccessMode={preferences.connectorAccessMode}
        onChange={setDraft}
        onSend={() => void submit()}
        onFiles={addFiles}
        onOpenModels={() => {
          haptic("selection", preferences.haptics);
          setModelPickerOpen(true);
        }}
        onOpenVoice={() => {
          setSettingsOpen(false);
          setVoiceOpen(true);
          haptic("selection", preferences.haptics);
        }}
        onToggleResearch={toggleResearch}
        onOpenTools={() => {
          setSettingsSection("capabilities");
          setSettingsOpen(true);
        }}
        onOpenProjects={() => setProjectsOpen(true)}
        onOpenConnectors={() => setConnectorsOpen(true)}
        onOpenPlaybooks={() => {
          setSettingsSection("playbooks");
          setSettingsOpen(true);
        }}
        onStop={() => {
          stop();
          setStreamStatus({ stage: "interrupted", detail: "You stopped this response." });
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        initialSection={settingsSection}
        durability={durability}
        preferences={preferences}
        onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }}
        onPreferences={updatePreferences}
        onOpenConnectors={() => setConnectorsOpen(true)}
        onClearData={() => void clearData()}
        onExport={exportData}
      />

      <ModelPickerSheet
        open={modelPickerOpen}
        preferences={preferences}
        onClose={() => setModelPickerOpen(false)}
        onPreferences={updatePreferences}
      />

      <ChatMenuSheet
        open={chatMenuOpen}
        chat={activeChat ?? null}
        projects={projects}
        haptics={preferences.haptics}
        incognito={incognito}
        onClose={() => setChatMenuOpen(false)}
        onToggleIncognito={() => {
          const next = !incognito;
          setIncognito(next);
          // Turning it on removes whatever was already written for this chat.
          if (next) mutateChats((current) => current.filter((chat) => chat.id !== activeId));
          haptic(next ? "impact-medium" : "selection", preferences.haptics);
        }}
        onStar={() => pinChat(activeId, !(activeChat?.pinned ?? false))}
        onRename={renameActiveChat}
        onShare={() => void shareActiveChat()}
        onAddToProject={() => setProjectsOpen(true)}
        onClearThread={clearThread}
        onDelete={() => deleteChat(activeId)}
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

      <ArtifactsSheet
        open={artifactsOpen}
        chats={chats}
        haptics={preferences.haptics}
        onClose={() => setArtifactsOpen(false)}
        onOpenChat={openChat}
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
