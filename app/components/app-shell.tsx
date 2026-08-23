"use client";
import { useChat } from "@ai-sdk/react";
import { describeResult, runInSandbox } from "@/lib/execution/sandbox";
import { MAX_REPAIR_ROUNDS } from "@/lib/ai/execution-tools";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart, type UIMessage } from "ai";
import { 
  ChevronDown, 
  FolderKanban, 
  Ghost, 
  Link2, 
  PanelLeft, 
  WifiOff, 
  SquarePen, 
  MessageSquare, 
  SquareTerminal 
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { AttachmentMeta, MenuSection, NaviMode, NaviPreferences, NaviProject, NaviStreamStatus, StoredChat } from "@/lib/ai/types";
import {
  ATTACHMENT_BUDGET,
  MAX_ATTACHMENTS,
  MAX_IMAGE_INPUT_BYTES,
  isResizableImage,
  prepareAttachments
} from "@/lib/ui/attachments";
import { DEFAULT_PREFERENCES, EFFORT_LEVELS, NAVI_MODES, chatPreview, chatTitle, createId, messageText, sortChats } from "@/lib/chat";
import {
  clearLocalState,
  loadLocalState,
  requestPersistentStorage,
  setLocalValue,
  type StorageDurability
} from "@/lib/storage/indexeddb";
import { historyAnswer, memoryBlock, recall } from "@/lib/memory";
import {
  mergeCloudChats,
  pullCloudMemory,
  pushChatDeletion,
  queueChatPush,
  queuePreferencesPush,
  setCloudSyncEnabled
} from "@/lib/memory/cloud-sync";
import { BUILT_IN_PLAYBOOKS, playbookBlock, selectPlaybook, type Playbook } from "@/lib/playbooks";
import { instantAnswer, parseSlashCommand, runSlash } from "@/lib/skills";
import { decideLocallyWithSkills } from "@/lib/ai/navi-soul/router";
import { NAVI_VERSION } from "@/lib/version";
import { haptic } from "@/lib/ui/haptics";
import { useEdgeSwipe } from "@/lib/ui/use-edge-swipe";
import { releaseOverlaysForNavigation, useOverlayRoute } from "@/lib/ui/overlay-route";
import { persistThemeCookie } from "@/lib/ui/theme-cookie";
import { useVoiceConversation } from "@/lib/ui/voice-conversation";
import type { AddedCapability } from "@/lib/ai/capabilities/search";
import { ComposerDock } from "./composer-dock";
import { ConnectorsSheet } from "./connectors-sheet";
import { FilesScreen } from "./files-screen";
import { ImagesScreen } from "./images-screen";
import { ToolsScreen } from "./tools-screen";
import { ConversationStatePanel } from "./conversation-state-panel";
import { HistoryDrawer } from "./history-drawer";
import { LaunchSurface } from "./launch-surface";
import { ProviderSetupNotice } from "./provider-setup-notice";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageRow } from "./message-row";
import { ArtifactsSheet } from "./artifacts-sheet";
import { ChatMenuSheet } from "./chat-menu-sheet";
import { EffortSheet } from "./effort-sheet";
import { ProjectsSheet } from "./projects-sheet";
import { PwaPlatformBanner } from "./pwa-platform-banner";
import { SettingsSheet } from "./settings-sheet";

const MAX_CHATS = 40;
const RECENT_ROWS = 20;
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

const SUMMARY_BUDGET = 8_000;
const OPENING_TURNS = 6;
const OPENING_SHARE = 0.35;

function compactSummary(messages: UIMessage[]): string {
  if (messages.length <= 14) return "";
  const lines = messages
    .slice(0, -12)
    .map((message) => `${message.role === "user" ? "User" : "Navi Soul"}: ${messageText(message).slice(0, 700)}`)
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

function standaloneDisplay(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export type InitialLayer =
  | "history"
  | "projects"
  | "artifacts"
  | "connectors"
  | "settings"
  | "customize"
  | "voice";

export type ShellView = "chat" | "files" | "images" | "tools";

const VIEW_TITLES: Record<Exclude<ShellView, "chat">, string> = {
  files: "Files",
  images: "Images",
  tools: "Tools"
};

const VIEW_SUBTITLES: Record<Exclude<ShellView, "chat">, string> = {
  files: "On this device",
  images: "Generated by Navi Soul",
  tools: "What Navi Soul may reach for"
};

export function AppShell({
  initialChatId,
  initialDraft,
  initialLayer
}: {
  initialChatId?: string;
  initialDraft?: string;
  initialLayer?: InitialLayer;
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
  const [settingsOpen, setSettingsOpen] = useState(initialLayer === "settings" || initialLayer === "customize");
  const [settingsSection, setSettingsSection] = useState<MenuSection | undefined>(
    initialLayer === "customize" ? "skills" : undefined
  );
  const [effortSheetOpen, setEffortSheetOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [composeMenuOpen, setComposeMenuOpen] = useState(false);
  const [incognito, setIncognito] = useState(false);
  const [artifactAudit, setArtifactAudit] = useState<{ title: string; findings: string[] } | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const freshDevice = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(initialLayer === "history");
  const [projectsOpen, setProjectsOpen] = useState(initialLayer === "projects");
  const [connectorsOpen, setConnectorsOpen] = useState(initialLayer === "connectors");
  const [artifactsOpen, setArtifactsOpen] = useState(initialLayer === "artifacts");
  const [view, setView] = useState<ShellView>("chat");
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [scrolled, setScrolled] = useState(false);
  const [streamStatus, setStreamStatus] = useState<NaviStreamStatus | null>(null);
  const [turnFailedAt, setTurnFailedAt] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [contextMessage, setContextMessage] = useState<{ id: string; text: string; role: string } | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPersistAt = useRef(0);
  const titleRequested = useRef<Set<string>>(new Set());
  const anchoredUserId = useRef<string | null>(null);
  const anchorTop = useRef(0);

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  
  const [systemOwnsEdge, setSystemOwnsEdge] = useState(false);
  useEffect(() => { setSystemOwnsEdge(standaloneDisplay()); }, []);
  const edgeSwipe = useEdgeSwipe({ disabled: historyOpen || systemOwnsEdge, haptics: preferences.haptics, onOpen: openHistory });

  const lastReadChat = hydrated
    ? chats.reduce<StoredChat | null>((newest, chat) => (!newest || chat.updatedAt > newest.updatedAt ? chat : newest), null)
    : null;
  const restorePath = chats.some((chat) => chat.id === activeId)
    ? `/chat/${encodeURIComponent(activeId)}`
    : lastReadChat
      ? `/chat/${encodeURIComponent(lastReadChat.id)}`
      : "/";
  useOverlayRoute({ open: historyOpen, onClose: () => setHistoryOpen(false), path: "/recents", restore: restorePath });
  useOverlayRoute({ open: settingsOpen, onClose: () => { setSettingsOpen(false); setSettingsSection(undefined); }, path: "/settings", restore: restorePath });
  useOverlayRoute({ open: connectorsOpen, onClose: () => setConnectorsOpen(false), path: "/connectors", restore: restorePath });
  useOverlayRoute({ open: projectsOpen, onClose: () => setProjectsOpen(false), path: "/projects", restore: restorePath });
  useOverlayRoute({ open: artifactsOpen, onClose: () => setArtifactsOpen(false), path: "/artifacts", restore: restorePath });
  useOverlayRoute({ open: chatMenuOpen, onClose: () => setChatMenuOpen(false), restore: restorePath });
  useOverlayRoute({ open: effortSheetOpen, onClose: () => setEffortSheetOpen(false), restore: restorePath });
  useOverlayRoute({ open: composeMenuOpen, onClose: () => setComposeMenuOpen(false) });
  useOverlayRoute({ open: contextMessage !== null, onClose: () => setContextMessage(null), restore: restorePath });

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const repairRounds = useRef(0);
  
  const [pendingApproval, setPendingApproval] = useState<{ title: string; detail: string; reason: string } | null>(null);
  const approvalAnswer = useRef<((granted: boolean) => void) | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const chatsRef = useRef<StoredChat[]>(chats);
  chatsRef.current = chats;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
    setMessages,
    addToolResult
  } = useChat({
    transport,
    experimental_throttle: 32,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "search_history") {
        const input = toolCall.input as { query?: string; limit?: number };
        addToolResult({
          tool: "search_history",
          toolCallId: toolCall.toolCallId,
          output: historyAnswer(
            typeof input?.query === "string" ? input.query : "",
            chatsRef.current,
            activeIdRef.current,
            { limit: typeof input?.limit === "number" ? input.limit : undefined }
          )
        });
        return;
      }

      if (toolCall.toolName === "approve_capability_write") {
        const input = toolCall.input as { capability?: string; operation?: string; reason?: string };
        addToolResult({
          tool: "approve_capability_write",
          toolCallId: toolCall.toolCallId,
          output: await requestWriteApproval({
            capabilityId: typeof input?.capability === "string" ? input.capability : "",
            operationId: typeof input?.operation === "string" ? input.operation : "",
            reason: typeof input?.reason === "string" ? input.reason : ""
          })
        });
        return;
      }

      if (toolCall.toolName !== "run_javascript") return;
      const input = toolCall.input as { code?: string };
      const code = typeof input?.code === "string" ? input.code : "";

      if (!code.trim()) {
        addToolResult({ tool: "run_javascript", toolCallId: toolCall.toolCallId, output: "No code was supplied to run." });
        return;
      }

      repairRounds.current += 1;
      if (repairRounds.current > MAX_REPAIR_ROUNDS) {
        addToolResult({
          tool: "run_javascript",
          toolCallId: toolCall.toolCallId,
          output: `This code has already been run ${MAX_REPAIR_ROUNDS} times without succeeding. Stop repairing it. Present your best attempt and state plainly what is still failing.`
        });
        return;
      }

      const result = await runInSandbox(code);
      addToolResult({ tool: "run_javascript", toolCallId: toolCall.toolCallId, output: describeResult(result) });
    },
    onData: (part) => {
      if (part.type === "data-status") setStreamStatus(part.data as NaviStreamStatus);
    },
    onFinish: ({ isError, isAbort }) => {
      if (isAbort) {
        setStreamStatus({ stage: "interrupted", detail: "You stopped this response." });
        return;
      }
      if (isError) {
        setStreamStatus(null);
        return;
      }
      setStreamStatus({ stage: "complete", detail: "Response complete." });
      if (preferences.notifyOnComplete && document.visibilityState === "hidden"
        && "Notification" in window && Notification.permission === "granted") {
        void navigator.serviceWorker?.getRegistration("/")
          .then((registration) => registration?.showNotification("NaviOS", {
            body: "Navi Soul has finished a response.",
            icon: "/pwa-icon-192-v5.png",
            badge: "/pwa-icon-192-v5.png",
            tag: "navi-response-complete"
          }))
          .catch(() => undefined);
      }
    },
    onError: (chatError) => {
      console.error("Navi Soul chat error:", chatError);
      setStreamStatus({ stage: "error", detail: "That didn't go through." });
      setTurnFailedAt(Date.now());
    }
  });

  const generating = status === "submitted" || status === "streaming";
  const activeChat = chats.find((chat) => chat.id === activeId);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeMode = NAVI_MODES.find((item) => item.id === preferences.mode) ?? NAVI_MODES[0];
  const activeEffort = EFFORT_LEVELS.find((level) => level.id === preferences.effort) ?? EFFORT_LEVELS[1];
  const connectorMode = activeChat?.connectorAccessMode ?? preferences.connectorAccessMode;
  const statusText = streamStatus?.detail ?? (generating ? "Navi Soul is working" : preferences.mode === "code" ? activeMode.label : "");

  useEffect(() => {
    type ClerkGlobal = { loaded?: boolean; user?: { id?: string; firstName?: string | null } | null };
    const read = () => {
      const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
      if (!clerk?.loaded) return false;
      if (!preferences.profile.displayName) setAccountName(clerk.user?.firstName?.trim() ?? "");
      setAccountId(clerk.user?.id ?? null);
      return true;
    };
    if (read()) return;
    const poll = window.setInterval(() => { if (read()) window.clearInterval(poll); }, 300);
    const stop = window.setTimeout(() => window.clearInterval(poll), 5_000);
    return () => { window.clearInterval(poll); window.clearTimeout(stop); };
  }, [preferences.profile.displayName]);

  const recalledContext = useCallback((question: string) => {
    if (incognito || !preferences.memory || !question.trim()) return "";
    return memoryBlock(recall(question, chats, activeId));
  }, [activeId, chats, incognito, preferences.memory]);

  const playbooks = useMemo<Playbook[]>(() => [
    ...BUILT_IN_PLAYBOOKS,
    ...preferences.customPlaybooks.map((entry) => ({ ...entry, source: "custom" as const }))
  ], [preferences.customPlaybooks]);

  useEffect(() => {
    function receive(event: Event) {
      const detail = (event as CustomEvent).detail as { title?: string; findings?: string[] } | undefined;
      if (!detail || !Array.isArray(detail.findings)) return;
      setArtifactAudit(detail.findings.length ? { title: String(detail.title ?? "artifact"), findings: detail.findings } : null);
    }
    window.addEventListener("navi:artifact-audit", receive);
    return () => window.removeEventListener("navi:artifact-audit", receive);
  }, []);

  const lastVoiceRef = useRef<{ engine: string; why: string } | null>(null);

  const requestBody = useCallback((question?: string, spoken = false) => ({
    mode: preferences.mode,
    voice: spoken,
    spokenBy: lastVoiceRef.current ?? undefined,
    artifactAudit: artifactAudit && artifactAudit.findings.length ? artifactAudit : undefined,
    routeOverride: preferences.routeOverride,
    effort: preferences.effort,
    tools: preferences.tools,
    memory: question ? recalledContext(question) : "",
    remember: !incognito && preferences.memory,
    playbook: question ? playbookBlock(selectPlaybook(question, playbooks)) : "",
    threadSummary: activeChat?.summary ?? compactSummary(messages),
    connectedMcpServers: preferences.connectedMcpServers,
    customConnectors: preferences.customConnectors,
    capabilities: preferences.capabilities,
    connectorAccessMode: activeChat?.connectorAccessMode ?? preferences.connectorAccessMode,
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
      knowledge: activeProject.knowledge,
      documents: activeProject.documents
    } : undefined
  }), [activeChat?.connectorAccessMode, activeChat?.summary, activeProject, artifactAudit, messages, playbooks, preferences, recalledContext]);

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
        freshDevice.current = state.fresh;
        setDraft(initialDraft ?? state.draft);
        const requestedChat = initialChatId
          ? state.chats.find((chat) => chat.id === initialChatId)
          : undefined;
        if (requestedChat) {
          setActiveId(requestedChat.id);
          setActiveProjectId(requestedChat.projectId ?? null);
          setMessages(requestedChat.messages);
        } else {
          setActiveId(initialChatRef.current);
          setMessages([]);
        }
      })
      .catch((storageError) => console.error("NaviOS local-state restore failed:", storageError))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialChatId, initialDraft, setMessages]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void pullCloudMemory().then((cloud) => {
      if (cancelled || !cloud) return;
      if (cloud.chats.length) {
        setChats((current) => {
          const merged = sortChats(mergeCloudChats(current, cloud.chats));
          void setLocalValue("chats", merged);
          return merged;
        });
      }
      if (cloud.preferences && freshDevice.current) {
        freshDevice.current = false;
        setPreferences((current) => {
          const restored = { ...current, ...cloud.preferences };
          void setLocalValue("preferences", restored);
          return restored;
        });
      }
    });
    return () => { cancelled = true; };
  }, [hydrated, accountId]);

  useEffect(() => {
    setCloudSyncEnabled(hydrated && !incognito && preferences.saveHistory);
  }, [hydrated, incognito, preferences.saveHistory]);

  useEffect(() => {
    const apply = () => {
      const next = resolvedTheme(preferences.theme);
      const changed = document.documentElement.dataset.theme !== next;
      setTheme(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("navi.theme.v3", next);
      persistThemeCookie(next);

      if (changed && standaloneDisplay()) window.location.reload();
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
    const timer = window.setTimeout(() => {
      void setLocalValue("preferences", preferences);
      queuePreferencesPush(preferences);
    }, 180);
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
        queueChatPush(nextChat);
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeId, activeProjectId, hydrated, incognito, messages, preferences.connectorAccessMode, preferences.saveHistory]);

  useEffect(() => {
    if (!hydrated || incognito || !preferences.saveHistory) return;
    if (status !== "ready" || titleRequested.current.has(activeId)) return;
    if (!chats.some((chat) => chat.id === activeId)) return;

    const question = messageText(messages.find((message) => message.role === "user") ?? ({ parts: [] } as never));
    const answer = messageText(messages.find((message) => message.role === "assistant") ?? ({ parts: [] } as never));
    if (!question.trim() || !answer.trim()) return;

    const chatId = activeId;
    titleRequested.current.add(chatId);
    const controller = new AbortController();
    void fetch("/api/chat/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { title?: unknown } | null) => {
        const title = typeof data?.title === "string" ? data.title.trim() : "";
        if (!title) return;
        setChats((current) => {
          const next = current.map((chat) => {
            if (chat.id !== chatId) return chat;
            const generated = chat.title === chatTitle(chat.messages) || chat.title === "New chat";
            return generated ? { ...chat, title } : chat;
          });
          void setLocalValue("chats", next);
          return next;
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeId, chats, hydrated, incognito, messages, preferences.saveHistory, status]);

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
      if (bottom < anchorTop.current) return;
      scroller.scrollTo({ top: bottom, behavior: status === "streaming" ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFollow, generating, messages, status, streamStatus]);

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

  useEffect(() => {
    document.documentElement.dataset.streaming = generating ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.streaming;
    };
  }, [generating]);

  const latestReply = useMemo(() => {
    if (generating) return null;
    const latest = [...messages].reverse().find((message) => message.role === "assistant" && messageText(message).trim());
    return latest ? { id: latest.id, text: messageText(latest) } : null;
  }, [generating, messages]);

  const conversation = useVoiceConversation({
    online,
    busy: generating,
    language: preferences.voiceLanguage,
    rate: preferences.voiceRate,
    haptics: preferences.haptics,
    reply: latestReply,
    failedAt: turnFailedAt,
    onTurn: (text) => void submitVoiceTranscript(text)
  });

  useEffect(() => {
    lastVoiceRef.current = conversation.voice;
  }, [conversation.voice]);

  const shortcutHonoured = useRef(false);
  useEffect(() => {
    if (initialLayer !== "voice" || shortcutHonoured.current) return;
    shortcutHonoured.current = true;
    conversation.start();
  }, [conversation, initialLayer]);

  useEffect(() => () => stopSpeaking(), []);

  const installCapability = useCallback((playbook: { id: string; name: string; description: string; instructions: string }) => {
    setPreferences((current) => ({
      ...current,
      customPlaybooks: [
        ...current.customPlaybooks.filter((entry) => entry.id !== playbook.id),
        playbook
      ].slice(-40)
    }));
    void fetch("/api/memory/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: playbook.name,
        description: playbook.description,
        instructions: playbook.instructions
      })
    }).catch(() => {});
    haptic("impact-medium", preferences.haptics);
  }, [preferences.haptics]);

  const removeCapability = useCallback((id: string) => {
    setPreferences((current) => ({
      ...current,
      customPlaybooks: current.customPlaybooks.filter((entry) => entry.id !== id)
    }));
  }, []);

  const capabilityHandlers = useMemo(() => ({
    installedIds: preferences.customPlaybooks.map((entry) => entry.id),
    onInstall: installCapability,
    onRemove: removeCapability
  }), [preferences.customPlaybooks, installCapability, removeCapability]);

  const requestWriteApproval = useCallback(async (input: { capabilityId: string; operationId: string; reason: string }) => {
    const stored = (preferencesRef.current.capabilities ?? []) as AddedCapability[];
    const capability = stored.find((entry) => entry?.manifest?.id === input.capabilityId);
    const operation = capability?.manifest.operations.find((entry) => entry.id === input.operationId);

    if (!capability || !operation) return `There is no operation "${input.operationId}" on "${input.capabilityId}" to approve.`;
    if (!operation.writes) return `${operation.id} only reads, so it needs no approval. Just call it.`;
    if (capability.approvedWrites.includes(operation.id)) return `${operation.id} was already approved. Call it.`;

    if (approvalAnswer.current) return "Another approval is already open on screen. Wait for that one to be answered.";

    haptic("warning", preferencesRef.current.haptics);
    const granted = await new Promise<boolean>((resolve) => {
      approvalAnswer.current = resolve;
      setPendingApproval({
        title: `${capability.manifest.name} · ${operation.id}`,
        detail: `${operation.method} ${operation.path} — ${operation.summary}`,
        reason: input.reason
      });
    });
    approvalAnswer.current = null;
    setPendingApproval(null);

    if (!granted) return `The owner declined. ${operation.id} was not called and is not approved. Do not ask again in this conversation or look for another way to do it.`;

    const current = preferencesRef.current;
    updatePreferences({
      ...current,
      capabilities: ((current.capabilities ?? []) as AddedCapability[]).map((entry) => entry?.manifest?.id === input.capabilityId
        ? { ...entry, approvedWrites: [...new Set([...entry.approvedWrites, operation.id])] }
        : entry)
    });
    return `Approved. ${operation.id} on ${capability.manifest.name} may now be called, and will not ask again.`;
  }, []);

  const updatePreferences = useCallback((next: NaviPreferences) => {
    setPreferences(next);
    setChats((current) => current.map((chat) => chat.id === activeId
      ? { ...chat, connectorAccessMode: next.connectorAccessMode }
      : chat));
  }, [activeId]);

  const newChat = useCallback(() => {
    if (generating) stop();
    stopSpeaking();
    conversation.stop();
    setActiveId(createId());
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setIncognito(false);
    setAttachmentError(null);
    setStreamStatus(null);
    clearError();
    releaseOverlaysForNavigation();
    setHistoryOpen(false);
    conversation.stop();
    router.push("/new");
  }, [clearError, generating, router, setMessages, stop]);

  const openChat = useCallback((chat: StoredChat) => {
    if (generating) stop();
    stopSpeaking();
    conversation.stop();
    setActiveId(chat.id);
    setActiveProjectId(chat.projectId ?? null);
    setMessages(chat.messages);
    setDraft("");
    setPendingFiles([]);
    setStreamStatus(null);
    clearError();
    releaseOverlaysForNavigation();
    setHistoryOpen(false);
    setView("chat");
    router.push(`/chat/${encodeURIComponent(chat.id)}`);
  }, [clearError, generating, router, setMessages, stop]);

  const openChatById = useCallback((chatId: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (chat) openChat(chat);
    else setView("chat");
  }, [chats, openChat]);

  function mutateChats(mutator: (current: StoredChat[]) => StoredChat[], syncIds: string[] = []) {
    setChats((current) => {
      const next = sortChats(mutator(current));
      void setLocalValue("chats", next);
      for (const id of syncIds) {
        const changed = next.find((chat) => chat.id === id);
        if (changed) queueChatPush(changed);
      }
      return next;
    });
  }

  function renameChat(id: string, title: string) {
    mutateChats((current) => current.map((chat) => chat.id === id ? { ...chat, title } : chat), [id]);
  }

  function pinChat(id: string, pinned: boolean) {
    mutateChats((current) => current.map((chat) => chat.id === id ? { ...chat, pinned } : chat), [id]);
  }

  function deleteChat(id: string) {
    mutateChats((current) => current.filter((chat) => chat.id !== id));
    pushChatDeletion(id);
    if (activeId === id) newChat();
  }

  function rateMessage(messageId: string, value: "up" | "down") {
    mutateChats((current) => current.map((chat) => {
      if (chat.id !== activeId) return chat;
      const ratings = { ...(chat.ratings ?? {}) };
      if (ratings[messageId] === value) delete ratings[messageId];
      else ratings[messageId] = value;
      return { ...chat, ratings };
    }));
  }

  const liveHandlers = useRef({ rateMessage, retry });
  liveHandlers.current = { rateMessage, retry };
  const stableRate = useCallback((messageId: string, value: "up" | "down") => liveHandlers.current.rateMessage(messageId, value), []);
  const stableRetry = useCallback(() => liveHandlers.current.retry(), []);

  function renameActiveChat() {
    const current = chats.find((chat) => chat.id === activeId);
    const title = window.prompt("Rename this chat", current?.title ?? "")?.trim();
    if (title) renameChat(activeId, title.slice(0, 80));
  }

  async function shareActiveChat() {
    haptic("selection", preferences.haptics);
    const current = chats.find((chat) => chat.id === activeId);
    const transcript = messages
      .map((message) => `${message.role === "user" ? "You" : "Navi Soul"}: ${messageText(message)}`)
      .filter((line) => !line.endsWith(": "))
      .join("\n\n");
    if (!transcript) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: current?.title ?? "NaviOS chat", text: transcript });
      } catch {
        // Cancelled by the user.
      }
      return;
    }
    await navigator.clipboard.writeText(transcript);
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

  async function runSkillCommand(): Promise<boolean> {
    const invocation = parseSlashCommand(draft);
    const decision = invocation
      ? null
      : await decideLocallyWithSkills(draft, { version: NAVI_VERSION, online }, instantAnswer);

    if (decision?.route === "client-command") {
      if (decision.command !== "/clear") return false;
      newChat();
      return true;
    }

    const instant = decision?.route === "local" ? decision : null;
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
      parts: [{ type: "text", text: invocation ? await runSlash(invocation) : instant!.response }]
    };
    setMessages([...messages, question, answer]);
    setStreamStatus(null);
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
      const preserveDetail = /\b(document|paper|form|receipt|invoice|statement|spreadsheet|table|label|sign|menu|page|letter|contract|report|ticket|screenshot|text|number|numbers|digit|digits|amount|date|total|handwriting|handwritten)\b/i.test(draft)
        || /\b(?:do\s?n[o']?t|don't|never)\s+(?:change|alter|modify|touch)\b/i.test(draft)
        || /\bkeep\s+.{1,40}?\s+(?:the\s+same|unchanged|as\s+is|intact)\b/i.test(draft);
      const conversationBytes = JSON.stringify(messages).length;
      const { files: outgoing, notice } = await prepareAttachments(pendingFiles, preserveDetail, conversationBytes);
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
      repairRounds.current = 0;
      await sendMessage({ text, files }, { body: requestBody(text) });
    } catch (submitError) {
      setAttachmentError(submitError instanceof Error ? submitError.message : "Could not prepare attachments.");
      setStreamStatus({ stage: "error", detail: "Could not prepare or send this request." });
    }
  }

  async function submitVoiceTranscript(text: string) {
    if (!text.trim() || generating || !online) return;
    clearError();
    setAttachmentError(null);
    setStreamStatus({
      stage: "gather",
      detail: activeProject ? `Loading ${activeProject.name} project context.` : preferences.tools.web ? "Starting research for your spoken request." : "Preparing your spoken request."
    });
    try {
      repairRounds.current = 0;
      await sendMessage({ text: text.trim() }, { body: requestBody(text, true) });
    } catch (voiceError) {
      setStreamStatus({
        stage: "error",
        detail: voiceError instanceof Error ? voiceError.message : "Could not send the spoken request."
      });
      setTurnFailedAt(Date.now());
    }
  }

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
    conversation.stop();
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
    conversation.stop();
    setActiveId(createId());
  }

  function toggleCodeMode() {
    const next = preferences.mode === "code" ? "chat" : "code";
    haptic("selection", preferences.haptics);
    updatePreferences({ ...preferences, mode: next });
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
      className={`${preferences.density === "compact" ? "density-compact" : "density-comfortable"} relative flex flex-col bg-app text-primary w-full overflow-hidden`}
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
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
        onNew={() => {
          if (preferences.mode !== "chat") updatePreferences({ ...preferences, mode: "chat" });
          newChat();
        }}
        onNewCode={() => {
          if (preferences.mode !== "code") updatePreferences({ ...preferences, mode: "code" });
          newChat();
        }}
        onProjects={() => setProjectsOpen(true)}
        projects={projects}
        onSettings={() => setSettingsOpen(true)}
        onOpen={openChat}
        onRename={renameChat}
        onPin={pinChat}
        onDelete={deleteChat}
      />

      <header className="navi-header relative z-50 flex min-h-[44px] pt-[env(safe-area-inset-top)] pb-2 shrink-0 items-center justify-between bg-page px-[max(8px,env(safe-area-inset-left))] border-b border-[var(--border-subtle)]" style={{ paddingRight: 'max(8px, env(safe-area-inset-right))' }} data-scrolled={String(scrolled)}>
        <div className="flex w-16 items-center justify-start pl-1">
          <button
            type="button"
            onClick={() => {
              haptic("impact-light", preferences.haptics);
              setHistoryOpen(true);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full text-accent active:opacity-60"
            aria-label="Open sidebar"
          >
            <PanelLeft size={28} strokeWidth={1.5} className="-ml-1" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic("selection", preferences.haptics);
            if (messages.length > 0 && activeChat) setChatMenuOpen(true);
          }}
          className="flex flex-1 flex-col items-center justify-center text-center min-w-0 px-2 active:opacity-60"
        >
          <div className="flex items-center justify-center gap-1 w-full">
            <span className="truncate text-[17px] font-semibold tracking-[-0.41px] text-primary">
              {view === "chat"
                ? (activeChat?.title && activeChat.title !== "New chat" ? activeChat.title : (preferences.mode === "code" ? "NaviOS Code" : "NaviOS Chat"))
                : VIEW_TITLES[view]}
            </span>
            {view === "chat" && messages.length > 0 && <ChevronDown size={14} className="text-tertiary shrink-0" />}
          </div>
          {view !== "chat" && VIEW_SUBTITLES[view] && (
            <span className="block truncate text-[11px] font-medium text-tertiary w-full">
              {VIEW_SUBTITLES[view]}
            </span>
          )}
        </button>

        <div className="flex w-16 items-center justify-end pr-2 gap-2">
          {incognito && (
            <span className="text-accent" title="Incognito">
              <Ghost size={19} strokeWidth={1.8} />
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              haptic("selection", preferences.haptics);
              setComposeMenuOpen(true);
            }}
            className="flex items-center justify-center text-accent active:opacity-60"
            aria-label="Compose Menu"
          >
            <SquarePen size={26} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/* The beautiful iOS 16 Dropdown Menu for New Chat/Code */}
      {composeMenuOpen && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setComposeMenuOpen(false)} />
          <div className="absolute top-[calc(env(safe-area-inset-top)+48px)] right-4 z-[110] w-[210px] rounded-[14px] bg-[#F2F2F7]/95 dark:bg-[#1E1E1E]/95 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-[#3C3C434A] dark:border-[#545458A6] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setComposeMenuOpen(false);
                haptic("selection", preferences.haptics);
                if (preferences.mode !== "chat") updatePreferences({ ...preferences, mode: "chat" });
                newChat();
              }}
              className="flex w-full min-h-[44px] items-center justify-between px-4 text-[17px] tracking-[-0.41px] text-primary border-b border-[#3C3C434A] dark:border-[#545458A6] active:bg-black/10 dark:active:bg-white/10"
            >
              New Chat
              <MessageSquare size={18} className="text-primary" />
            </button>
            <button
              type="button"
              onClick={() => {
                setComposeMenuOpen(false);
                haptic("selection", preferences.haptics);
                if (preferences.mode !== "code") updatePreferences({ ...preferences, mode: "code" });
                newChat();
              }}
              className="flex w-full min-h-[44px] items-center justify-between px-4 text-[17px] tracking-[-0.41px] text-primary active:bg-black/10 dark:active:bg-white/10"
            >
              New Code Session
              <SquareTerminal size={18} className="text-primary" />
            </button>
          </div>
        </>
      )}

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
      ) : preferences.connectedMcpServers.length ? (
        <button type="button" onClick={() => setConnectorsOpen(true)} className="flex min-h-9 items-center justify-center gap-2 border-y border-[var(--border-subtle)] bg-elev-2 px-4 text-center text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3">
          <Link2 size={14} />
          {preferences.connectedMcpServers.length} connector{preferences.connectedMcpServers.length === 1 ? "" : "s"} · {connectorMode}
        </button>
      ) : null}

      <main
        ref={scrollRef}
        data-scroll-region="true"
        className="min-h-0 flex-1 w-full"
        onScroll={(event) => {
          const el = event.currentTarget;
          setScrolled(el.scrollTop > 3);
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          const bottom = distanceFromBottom < 90;
          setAtBottom(bottom);
          setAutoFollow(bottom);
        }}
      >
        {view === "files" ? (
          <FilesScreen chats={chats} haptics={preferences.haptics} onOpenChat={openChatById} />
        ) : view === "images" ? (
          <ImagesScreen chats={chats} haptics={preferences.haptics} onOpenChat={openChatById} />
        ) : view === "tools" ? (
          <ToolsScreen
            preferences={preferences}
            onPreferences={updatePreferences}
            onConnectors={() => setConnectorsOpen(true)}
            onArtifacts={() => setArtifactsOpen(true)}
          />
        ) : messages.length === 0 && !hydrated && initialChatId ? (
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
          <LaunchSurface online={online} name={preferences.profile.displayName || accountName || undefined}>
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
                  recent={messages.length - index <= RECENT_ROWS}
                  theme={theme}
                  chatFont={preferences.chatFont}
                  haptics={preferences.haptics}
                  voiceLanguage={preferences.voiceLanguage}
                  voiceRate={preferences.voiceRate}
                  rating={activeChat?.ratings?.[message.id]}
                  onRate={message.role === "assistant" ? stableRate : undefined}
                  onRetry={message.role === "assistant" && index === messages.length - 1 && !generating && online ? stableRetry : undefined}
                  onLongPress={setContextMessage}
                  capabilities={capabilityHandlers}
                />
              ))}
            </div>
            <ConversationStatePanel
              research={preferences.tools.web}
              generating={generating}
              status={streamStatus}
            />
            {error ? (
              <div className="mt-4 rounded-[14px] border border-[var(--accent-danger)] bg-elev-2 p-4" role="alert">
                <p className="text-[15px] font-medium text-primary">{error.message || "That didn't go through. Tap to retry."}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={retry} className="min-h-11 rounded-[10px] bg-accent px-4 text-[15px] font-semibold text-white active:bg-opacity-80">Try again</button>
                  <button type="button" onClick={clearError} className="min-h-11 rounded-[10px] px-4 text-[15px] font-semibold text-secondary active:bg-elev-3">Dismiss</button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      {view === "chat" && messages.length > 0 && !atBottom ? (
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

      {view !== "chat" ? null : (
        <>
      {attachmentError ? (
        <div className="mx-4 mb-1 rounded-[14px] border border-[var(--accent-warning)] bg-elev-2 px-3 py-2 text-center text-[13px] font-medium text-warning" role="alert">{attachmentError}</div>
      ) : null}
      <div className="shrink-0 px-gutter">
        <PwaPlatformBanner inline />
      </div>
      <ComposerDock
        inputRef={composerRef}
        voiceLanguage={preferences.voiceLanguage}
        offlineCommand={parseSlashCommand(draft) !== null}
        value={draft}
        generating={generating}
        online={online}
        attachmentCount={pendingFiles.length}
        effortLabel={activeEffort.label}
        hasMessages={messages.length > 0}
        research={preferences.tools.web}
        codeMode={preferences.mode === "code"}
        onToggleCode={toggleCodeMode}
        statusText={activeProject ? `${activeProject.name} · ${statusText}` : statusText}
        haptics={preferences.haptics}
        connectorCount={preferences.connectedMcpServers.length}
        connectorAccessMode={preferences.connectorAccessMode}
        onChange={setDraft}
        onSend={() => void submit()}
        onFiles={addFiles}
        onOpenEffort={() => {
          haptic("selection", preferences.haptics);
          setEffortSheetOpen(true);
        }}
        conversation={conversation}
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
        </>
      )}

      <SettingsSheet
        open={settingsOpen}
        initialSection={settingsSection}
        durability={durability}
        preferences={preferences}
        localChatCount={chats.length}
        onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }}
        onPreferences={updatePreferences}
        onOpenConnectors={() => setConnectorsOpen(true)}
        onClearData={() => void clearData()}
        onExport={exportData}
      />

      <EffortSheet
        open={effortSheetOpen}
        preferences={preferences}
        onClose={() => setEffortSheetOpen(false)}
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

      {pendingApproval ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center md:items-center md:p-4" role="dialog" aria-modal="true" aria-label="Approve a write">
          <div className="absolute inset-0 bg-overlay backdrop-blur-[5px]" />
          <section className="menu-enter relative w-full max-w-[460px] rounded-t-[28px] border border-b-0 border-[var(--border-subtle)] bg-elev-1 p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-sheet md:rounded-[28px] md:border">
            <h2 className="text-[17px] font-semibold text-primary">This one changes something</h2>
            <p className="mt-1 text-[13px] font-medium text-secondary">{pendingApproval.title}</p>
            <p className="mt-3 break-words rounded-[14px] bg-elev-2 p-3 font-mono text-[12px] text-secondary">{pendingApproval.detail}</p>
            {pendingApproval.reason ? (
              <p className="mt-3 text-[15px] text-primary">{pendingApproval.reason}</p>
            ) : null}
            <p className="mt-3 text-[12px] font-medium text-tertiary">
              Approving remembers this one operation and never asks about it again. Everything else on this API still asks.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { haptic("impact-light", preferences.haptics); approvalAnswer.current?.(false); }}
                className="flex min-h-12 items-center justify-center rounded-[12px] border border-[var(--border-strong)] bg-elev-2 text-[15px] font-semibold text-primary active:bg-elev-3"
              >
                Not this time
              </button>
              <button
                type="button"
                onClick={() => { haptic("success", preferences.haptics); approvalAnswer.current?.(true); }}
                className="flex min-h-12 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-white active:bg-opacity-80"
              >
                Approve
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
