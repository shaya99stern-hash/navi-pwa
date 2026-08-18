"use client";
import { useChat } from "@ai-sdk/react";
import { describeResult, runInSandbox } from "@/lib/execution/sandbox";
import { MAX_REPAIR_ROUNDS } from "@/lib/ai/execution-tools";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart, type UIMessage } from "ai";
import { ChevronDown, Ellipsis, FolderKanban, Ghost, Link2, PanelLeft, SquarePen, WifiOff } from "lucide-react";
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
import { collectFiles, collectImages } from "@/lib/ui/library";
import { useEdgeSwipe } from "@/lib/ui/use-edge-swipe";
import { releaseOverlaysForNavigation, useOverlayRoute } from "@/lib/ui/overlay-route";
import { persistThemeCookie } from "@/lib/ui/theme-cookie";
import { useVoiceConversation } from "@/lib/ui/voice-conversation";
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
import { ModeSheet } from "./mode-sheet";
import { ProjectsSheet } from "./projects-sheet";
import { PwaPlatformBanner } from "./pwa-platform-banner";
import { SettingsSheet } from "./settings-sheet";

const MAX_CHATS = 40;
/**
 * Rows at the end of the thread that keep full layout.
 *
 * `content-visibility: auto` only remembers a row's height once that row has
 * been on screen, so scrolling back up through never-measured rows makes
 * WebKit revise its 220px guess mid-gesture and the thread moves under the
 * finger. This is the stretch people actually scroll, so it pays full layout;
 * everything above it stays skippable.
 */
const RECENT_ROWS = 20;
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

/** Installed to the Home Screen, where iOS owns the status bar. */
function standaloneDisplay(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * Which layer a deep link opens over the chat, rather than navigating to.
 *
 * One prop, one union. There used to be two — `initialSheet` for six of these
 * and `initialView` for voice — which was two names for one concept, and every
 * one of the seven routes means the same thing: "home, with a layer on top".
 * A second spelling of the same idea is where the next one comes from.
 */
export type InitialLayer =
  | "history"
  | "projects"
  | "artifacts"
  | "connectors"
  | "settings"
  | "customize"
  | "voice";

/**
 * Which screen the shell is showing.
 *
 * Files, Images and Tools are screens rather than sheets: each has its own
 * scroll position and its own title in the header, and none of them belongs
 * *over* a conversation the way a picker does. The chat keeps its state
 * underneath, so coming back to it is free.
 */
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

/**
 * What the app is called right now.
 *
 * The mode is the product, so it holds the header's dominant line in every
 * state rather than riding along as a pill beside the chat title. A pill is
 * read as decoration and was being missed; the name is read as the name.
 */
function modeTitle(mode: NaviMode) {
  return mode === "code" ? "NaviOS Code" : "NaviOS Chat";
}

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
  // /settings lands on the root list; /customize lands inside the Customize
  // group, whose first page is Skills.
  const [settingsSection, setSettingsSection] = useState<MenuSection | undefined>(
    initialLayer === "customize" ? "skills" : undefined
  );
  const [effortSheetOpen, setEffortSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  /* Incognito: this conversation is never written to storage and never
     recalled by memory. It exists only while the screen is open. */
  const [incognito, setIncognito] = useState(false);
  /**
   * What the last artifact actually measured once it was on screen.
   *
   * The reviewer runs before delivery; an artifact renders after it. So the
   * turn that produced a 900px frame around 400px of content can never be told
   * about it — but the next turn can, and the next turn is where "make this
   * more realistic" lands. Held for one artifact at a time, because a stale
   * audit describing a different artifact is worse than none.
   */
  const [artifactAudit, setArtifactAudit] = useState<{ title: string; findings: string[] } | null>(null);
  /* The name Clerk already knows, used only when the profile has none. Someone
     signed in has told the app who they are once already; making them type it
     again to be greeted by name is asking twice for the same thing. */
  const [accountName, setAccountName] = useState("");
  /* The signed-in user's id, watched rather than merely read: a fresh install
     opens signed-out, so the pull that matters is the one after sign-in. */
  const [accountId, setAccountId] = useState<string | null>(null);
  /* Whether this device arrived with nothing of its own. A ref because it
     gates a one-time restore and must not itself cause a render. */
  const freshDevice = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(initialLayer === "history");
  const [projectsOpen, setProjectsOpen] = useState(initialLayer === "projects");
  const [connectorsOpen, setConnectorsOpen] = useState(initialLayer === "connectors");
  const [artifactsOpen, setArtifactsOpen] = useState(initialLayer === "artifacts");
  /* The chat is the ground state; the library screens sit beside it, not over
     it, so switching back does not have to rebuild the thread. */
  const [view, setView] = useState<ShellView>("chat");
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [scrolled, setScrolled] = useState(false);
  const [streamStatus, setStreamStatus] = useState<NaviStreamStatus | null>(null);
  /* When the last request failed, for the spoken conversation to recover from. */
  const [turnFailedAt, setTurnFailedAt] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [contextMessage, setContextMessage] = useState<{ id: string; text: string; role: string } | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPersistAt = useRef(0);
  /* Chats already sent for a summarised title. One attempt each: the title is
     a nicety, and retrying it on every render would turn a nicety into traffic. */
  const titleRequested = useRef<Set<string>>(new Set());
  const anchoredUserId = useRef<string | null>(null);
  const anchorTop = useRef(0);

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  /* Concede the left edge when iOS owns it.
   *
   * Two correct mechanisms wanted the same 26 pixels. `use-edge-swipe` arms a
   * drawer-open drag there; `overlay-route` makes every overlay a real history
   * entry, which in standalone puts iOS's interactive back gesture on that same
   * edge. One swipe, two meanings, and which one won came down to WebKit.
   *
   * Back wins, because that is what a user expects from the edge and it is what
   * the overlay work bought. The drawer keeps its button, and swipe-to-close on
   * the open drawer is unaffected — that gesture starts inside the drawer, not
   * on the edge. In a browser tab there is no system gesture to collide with,
   * so the drag stays.
   */
  const [systemOwnsEdge, setSystemOwnsEdge] = useState(false);
  useEffect(() => { setSystemOwnsEdge(standaloneDisplay()); }, []);
  const edgeSwipe = useEdgeSwipe({ disabled: historyOpen || systemOwnsEdge, haptics: preferences.haptics, onOpen: openHistory });

  /* Every overlay is a place you can be, and back is how you leave it.
   *
   * These were plain booleans, so the back gesture skipped whatever was in
   * front of you and navigated the chat underneath — or off the app entirely.
   * On a phone that is the primary dismiss gesture, which is why the routing
   * "didn't feel a hundred percent": the sheets were not in the history at all.
   *
   * Where the overlay has a route of its own, the address follows it, so the
   * screen you are on is the screen the URL names — and closing puts it back
   * rather than leaving a stale `/settings` behind. The ones without a route
   * still take a history entry, because being dismissable by back matters more
   * than being linkable. */
  /* Where a link-opened overlay closes to. The stored list rather than the
     live message array, because a conversation only has an address once it has
     been written down — closing to `/chat/<id>` for a chat that does not exist
     yet would put a dead link in the address bar.

     The fallback is the most recently updated stored chat, not `/`.
     A cold PWA launch straight to /settings renders before IndexedDB has been
     read: `chats` is empty, `activeId` is a brand-new id, and the `some` test
     failed — so closing the sheet landed the user in a blank new chat instead
     of the conversation they had been reading. The same applied to every
     /recents, /projects and notification deep link. Once hydrated there is a
     real answer available, and `useOverlayRoute` reads `restore` through a ref,
     so it picks up the corrected value with no other change. */
  /* Most recently updated, computed rather than `chats[0]`: the stored order
     puts pinned conversations first, so the head of the list is whatever was
     pinned longest ago, not what was last read. */
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
  /* No route of their own — a menu is not a destination worth linking to — but
     back still closes them, which is the half that was actually missing. */
  useOverlayRoute({ open: chatMenuOpen, onClose: () => setChatMenuOpen(false), restore: restorePath });
  useOverlayRoute({ open: effortSheetOpen, onClose: () => setEffortSheetOpen(false), restore: restorePath });
  useOverlayRoute({ open: modeSheetOpen, onClose: () => setModeSheetOpen(false), restore: restorePath });
  useOverlayRoute({ open: contextMessage !== null, onClose: () => setContextMessage(null), restore: restorePath });

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  /* Counted per user turn, not per conversation: three attempts at this
     problem, then three fresh ones at the next. Reset on send below. */
  const repairRounds = useRef(0);
  /* The conversations and which one is open, as refs, because `onToolCall` is
     invoked long after the render that created it and a closed-over copy would
     be whatever the list held several turns ago. */
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
    /* Submit the tool result and let the model continue on its own. Without
       this the run happens, the result sits there, and the conversation stops
       one step short of the model ever reading its own error. */
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      /**
       * Searching the conversations, which only this side can do.
       *
       * They live in IndexedDB on this device and the edge runtime has never
       * seen one, so the tool is declared on the server with no `execute` and
       * answered here — the same path `run_javascript` takes to reach the
       * sandbox. Read from refs rather than from the enclosing render: this
       * callback can be invoked several turns after it was created, and the
       * chat list is the thing most likely to have changed since.
       */
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

      if (toolCall.toolName !== "run_javascript") return;
      const input = toolCall.input as { code?: string };
      const code = typeof input?.code === "string" ? input.code : "";

      if (!code.trim()) {
        addToolResult({ tool: "run_javascript", toolCallId: toolCall.toolCallId, output: "No code was supplied to run." });
        return;
      }

      /* The cap lives here because this is the only place that can count. The
         model is asked to stop after three attempts and mostly will; a model
         that does not would otherwise loop on the device until the request
         budget ran out. */
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
        /* The stream renders its own error card, so a second status line is a
           duplicate of the same failure. Clear it instead. */
        setStreamStatus(null);
        return;
      }
      /* No `haptic("success")` here, and none in `onError` below.
         Both mechanisms need transient user activation, and a reply finishes
         seconds after the tap that asked for it, so `haptics.ts` skipped the
         call every single time — the two events most worth feeling were the
         two that never fired, and nothing in the code said so.
         Completion is carried by the channels that need no activation: the
         status line settling in `conversation-state-panel`, and this
         notification when the app is not being looked at. */
      setStreamStatus({ stage: "complete", detail: "Response complete." });
      // Response-completion notification, only when the tab is not being
      // looked at — with it in view the finished text is its own signal.
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
      /* The error card the stream renders is the signal; a haptic here would
         be refused for the same reason the completion one was. */
      setStreamStatus({ stage: "error", detail: "That didn't go through." });
      /* And the spoken conversation, which otherwise waits in silence for a
         reply that is never coming. A timestamp rather than a flag, so two
         failures in a row are two events rather than one. */
      setTurnFailedAt(Date.now());
    }
  });

  const generating = status === "submitted" || status === "streaming";
  const activeChat = chats.find((chat) => chat.id === activeId);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  /* The mode is the product; the route is chosen per request by the router.
     Code mode reads as a state worth naming, Chat mode is the default and
     naming it would be noise. */
  const activeMode = NAVI_MODES.find((item) => item.id === preferences.mode) ?? NAVI_MODES[0];
  const activeEffort = EFFORT_LEVELS.find((level) => level.id === preferences.effort) ?? EFFORT_LEVELS[1];
  const connectorMode = activeChat?.connectorAccessMode ?? preferences.connectorAccessMode;
  const statusText = streamStatus?.detail ?? (generating ? "Navi Soul is working" : preferences.mode === "code" ? activeMode.label : "");
  /* The counts beside Files and Images in the drawer. Folded out of the same
     chats array the drawer already renders, so the number and the screen it
     leads to can never disagree — and memoised because scanning every message
     for image fences on each keystroke of a stream is not free. */
  const fileCount = useMemo(() => collectFiles(chats).length, [chats]);
  const imageCount = useMemo(() => collectImages(chats).length, [chats]);
  const toolsOn = preferences.tools.web || preferences.tools.code || preferences.tools.artifacts;

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
    /* Clerk loads asynchronously and the launch screen is the first thing
       drawn, so a single read almost always runs too early. The poll keeps
       going until it answers, which is also when a sign-in becomes visible
       here without a reload. */
    const poll = window.setInterval(() => { if (read()) window.clearInterval(poll); }, 300);
    const stop = window.setTimeout(() => window.clearInterval(poll), 5_000);
    return () => { window.clearInterval(poll); window.clearTimeout(stop); };
  }, [preferences.profile.displayName]);

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

  /* Measurements from the rendered artifact, arriving after its turn finished.
     A window event rather than a prop: `ArtifactFrame` renders from inside the
     markdown renderer, well below anything that talks to the model. */
  useEffect(() => {
    function receive(event: Event) {
      const detail = (event as CustomEvent).detail as { title?: string; findings?: string[] } | undefined;
      if (!detail || !Array.isArray(detail.findings)) return;
      setArtifactAudit(detail.findings.length ? { title: String(detail.title ?? "artifact"), findings: detail.findings } : null);
    }
    window.addEventListener("navi:artifact-audit", receive);
    return () => window.removeEventListener("navi:artifact-audit", receive);
  }, []);

  const requestBody = useCallback((question?: string, spoken = false) => ({
    mode: preferences.mode,
    /* Whether this answer is going to be *heard* rather than read.
       The server cannot infer it — a spoken turn and a typed one are the same
       shape by the time they arrive — and it changes how the answer should be
       written rather than how it is routed: shorter sentences, one idea at a
       time, no structure that only works on a page. A voice reading a bulleted
       report aloud is the single thing that makes a premium voice still sound
       like a machine. */
    voice: spoken,
    /* Only when something was actually wrong. A clean artifact has nothing
       worth spending prompt on, and sending "no problems found" every turn
       trains the model to ignore the field. */
    artifactAudit: artifactAudit && artifactAudit.findings.length ? artifactAudit : undefined,
    routeOverride: preferences.routeOverride,
    effort: preferences.effort,
    tools: preferences.tools,
    memory: question ? recalledContext(question) : "",
    /* Whether this turn may *add* to memory, as opposed to read from it. The
       server cannot infer it: an empty `memory` string means nothing was
       recalled, which is not the same as memory being switched off, and
       incognito is a client-side state entirely. */
    remember: !incognito && preferences.memory,
    playbook: question ? playbookBlock(selectPlaybook(question, playbooks)) : "",
    threadSummary: activeChat?.summary ?? compactSummary(messages),
    connectedMcpServers: preferences.connectedMcpServers,
    customConnectors: preferences.customConnectors,
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
          /* A chat that belongs to no project opens in no project.
             It used to fall back to whatever project was last active globally,
             and because the persist path stamps the active project onto every
             save, simply *opening* an unfiled chat quietly filed it into that
             project. So a conversation could appear inside a project the user
             never put it in — and the more they used projects, the more often
             it happened. `openChat` already reads it this way; only the
             restore-on-load path disagreed. */
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

  /**
   * Bring the cloud copy back down.
   *
   * Runs after local state so the UI never waits on the network, and again
   * whenever the signed-in identity changes — which is the reinstall case the
   * one-shot version missed. A fresh install opens signed-out, the first pull
   * returns nothing because there is nobody to pull for, and if that were the
   * only attempt the user would sign in to an empty app and conclude their
   * history was gone.
   *
   * Chats merge: newer copy wins per id, and a chat only one side knows about
   * always survives. Preferences do not merge — there is no per-field
   * timestamp to merge on — so they are restored only onto a device that had
   * nothing of its own, where there is nothing to lose. That is exactly the
   * reinstall, and it is what carries the profile, the standing instructions
   * and the tool policy back.
   */
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
        /* Once only. A second pull must not reapply the cloud copy over
           changes the user has made since the first one landed. */
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

  /* Sync mirrors history only when the user keeps history at all, and never
     from an incognito conversation. */
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

      /* iOS reads `apple-mobile-web-app-status-bar-style` once, at launch, and
         ignores every later mutation of the meta tag. Settings flips the theme
         live, so going dark → light left white glyphs on the ivory ground
         until the next cold launch: the app looked broken along its top edge,
         and nothing on screen explained why.

         Installed, the only way to re-tint the bar is to relaunch, so write
         the cookie and reload — the worker serves the shell, so it costs about
         a frame. In a browser tab the bar is the browser's own furniture and a
         reload would be an unexplained flash, so nothing happens there. The
         Appearance control says which of the two you are getting. */
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
        queueChatPush(nextChat);
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeId, activeProjectId, hydrated, incognito, messages, preferences.connectorAccessMode, preferences.saveHistory]);

  /**
   * A better title for the chat, once, after its first exchange.
   *
   * The heuristic title takes the first seven words of the question, which
   * beats echoing the prompt and still fills the drawer with truncated
   * openings — "Write me a function that takes" for a thread about parsing
   * dates. It is hard to scan exactly when scanning matters, which is when
   * there are enough chats to need the list.
   *
   * After the reply rather than during it, and in its own request: the chat
   * route's budget is time to first token, and nobody waiting for an answer is
   * helped by a title. Failure is silent and total — the heuristic title is
   * already on screen and stays there.
   */
  useEffect(() => {
    if (!hydrated || incognito || !preferences.saveHistory) return;
    if (status !== "ready" || titleRequested.current.has(activeId)) return;
    /* Only once the chat exists on the device. The write is debounced, so
       firing before it lands would resolve against a chat that is not there
       yet and drop the result. */
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
            /* Never over a name the user chose. Renaming is in the chat menu,
               and a title that quietly reverts is worse than no summary at
               all — so this only replaces one this app generated itself. */
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

  /* The first-token tick used to live here and had the same defect as the
     completion haptic: by the time a stream opens, the activation the tap
     granted has lapsed, so the call was skipped and the tick never happened.
     The streaming cursor and the status line are what announce the reply. */

  /**
   * The newest finished answer, for the spoken conversation to read aloud.
   *
   * Null while one is still streaming, which is what keeps the loop from
   * speaking half a sentence and then reopening the microphone over the rest
   * of it.
   */
  const latestReply = useMemo(() => {
    if (generating) return null;
    const latest = [...messages].reverse().find((message) => message.role === "assistant" && messageText(message).trim());
    return latest ? { id: latest.id, text: messageText(latest) } : null;
  }, [generating, messages]);

  /**
   * One tap in the composer and it is a conversation until it is tapped again.
   *
   * This replaces a sheet with five controls in it. The read-aloud switch is
   * gone because a conversation you cannot hear is not one, the hands-free
   * switch is gone because that is what this is, and the language picker is
   * gone because Settings already owns that preference and having two of them
   * meant the answer depended on which screen you last opened.
   */
  const conversation = useVoiceConversation({
    online,
    busy: generating,
    language: preferences.voiceLanguage,
    haptics: preferences.haptics,
    reply: latestReply,
    failedAt: turnFailedAt,
    onTurn: (text) => void submitVoiceTranscript(text)
  });

  /* The manifest shortcut promises "start a voice conversation", so it starts
     one rather than opening a screen about starting one. */
  const shortcutHonoured = useRef(false);
  useEffect(() => {
    if (initialLayer !== "voice" || shortcutHonoured.current) return;
    shortcutHonoured.current = true;
    conversation.start();
  }, [conversation, initialLayer]);

  useEffect(() => () => stopSpeaking(), []);

  /* Installing a capability Navi drafted. Same store and same cap as pasting
     one into Settings, so there is one library rather than two — a capability
     added from a message is indistinguishable afterwards from one added by
     hand, which is the point of the feature. */
  const installCapability = useCallback((playbook: { id: string; name: string; description: string; instructions: string }) => {
    setPreferences((current) => ({
      ...current,
      customPlaybooks: [
        // Re-adding an existing id replaces it rather than duplicating it.
        ...current.customPlaybooks.filter((entry) => entry.id !== playbook.id),
        playbook
      ].slice(-40)
    }));
    /* Also into durable memory, which is the difference between a capability
       that exists and one Navi Soul actually has. A playbook reaches the prompt
       only when the request happens to match it; a learned skill is carried
       into every conversation. Installing one used to do only the first, which
       is why "save this skill" felt like it did nothing. Best-effort: signed
       out or storage unconfigured, the local copy still works. */
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
    /* Both halves of one tap: dismiss the drawer and go somewhere. The drawer
       normally unwinds its own history entry on close, which is right for a
       dismissal and wrong here — the unwind lands after the router has
       navigated and cancels it. */
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

  /* Files and Images list what a conversation produced, so every row is a way
     back into that conversation. A row whose chat has since been deleted just
     returns to the thread view rather than opening nothing. */
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

  /* Handlers that keep the same identity across renders, so the memoised
     message rows can tell "nothing about this row changed" from "the draft
     changed one component up".
   *
   * Both are redeclared every render and close over live state — `retry` over
   * the project, the research switch and the message list, `rateMessage` over
   * the active chat. Passing those straight down would defeat the memo; freezing
   * them with a dependency list would let a row hold a closure from a render
   * where research was still on, and retry with the wrong settings. Reading the
   * current one through a ref keeps both properties at once. */
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
    /* On the gesture. Both branches below are async — the share sheet and the
       clipboard write — so a tick after either had no activation left. */
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
    //
    // The gate runs the system commands and arithmetic first and only then
    // consults the skill library, which is injected rather than imported so
    // the same decision function can be reached from the edge without pulling
    // a "use client" module into that bundle.
    const decision = invocation
      ? null
      : await decideLocallyWithSkills(draft, { version: NAVI_VERSION, online }, instantAnswer);

    /* Recognised on the device but not answerable as text: the conversation is
       the client's to own, so `/clear` is performed here. Anything else the
       gate hands back this way has no local action, and falls through to the
       model rather than dying silently. */
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
    /* No completion tick. `runSlash` is awaited above, so activation is gone
       and this fired for the synchronous instant answers and not the rest —
       the same command feeling different depending on how it resolved. The
       send button already ticked on the tap, and the answer appearing is the
       completion signal. */
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
      /* What the conversation itself will cost in this request. A chat that
         already contains photos re-sends them as data URLs, so the room left
         for a new one can be far smaller than the nominal budget — sizing
         against a fixed reserve is what produced "resized to fit" followed
         immediately by "that didn't go through". */
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
      /* The status panel above carries this. A tick here lands after
         `sendMessage` has been awaited, where there is no activation left to
         fire it. */
      setStreamStatus({ stage: "error", detail: "Could not prepare or send this request." });
    }
  }

  /**
   * A turn from the spoken conversation.
   *
   * The flag it sets is about the answer being *heard*, not about the question
   * having been spoken: dictating into the composer produces a written answer
   * someone reads at their own pace, and shortening that would be a loss. This
   * is the one path where the reply is going into the air, so it is the one
   * path that asks for the spoken cadence.
   *
   * Who reads it aloud is the conversation loop, which is why nothing here
   * starts any speech. It holds the audio handle, so it is the only thing that
   * can reliably stop it — and it has to know when the sound ends before it
   * dares open the microphone again.
   */
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
      /* This path never reaches `onError` — the request did not start — so the
         conversation would wait on a turn that was never sent. */
      setTurnFailedAt(Date.now());
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
        projects={projects}
        fileCount={fileCount}
        imageCount={imageCount}
        toolsOn={toolsOn}
        onFiles={() => { setView("files"); setHistoryOpen(false); }}
        onImages={() => { setView("images"); setHistoryOpen(false); }}
        onTools={() => { setView("tools"); setHistoryOpen(false); }}
        onSettings={() => setSettingsOpen(true)}
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
        {/* Left-aligned, in the flow, and stacked: the product on the top line
            and what you are looking at underneath it.

            It used to be absolutely centred, which is what forced the max
            width and the -translate-x-1/2 — one button on the left against two
            or three on the right means true centre is never the centre of the
            space that is actually free. Reading order on a phone starts at the
            left edge anyway, so the title now simply begins where the eye
            already is, and the truncation has the whole middle to work with
            instead of `calc(100% - 184px)`. */}
        {/* The chevron sits beside the product name, so it switches the
            product. That is what it looked like it did all along, and it gives
            the mode a home now that the drawer is navigation rather than
            configuration. On a library screen it goes back to the chat. */}
        <button
          type="button"
          onClick={() => {
            haptic("selection", preferences.haptics);
            if (view !== "chat") setView("chat");
            else setModeSheetOpen(true);
          }}
          className="flex min-w-0 flex-1 flex-col items-start rounded-lg pl-1 text-left active:bg-elev-2"
          aria-label={view === "chat" ? "Switch product" : "Back to chat"}
          aria-haspopup={view === "chat" ? "menu" : undefined}
        >
          <span className="flex max-w-full items-center gap-1.5">
            <span className="truncate text-[0.9375rem]/[1.125rem] font-semibold tracking-[-0.01em] text-primary">
              {view === "chat" ? modeTitle(preferences.mode) : VIEW_TITLES[view]}
            </span>
            <ChevronDown size={14} className="shrink-0 text-tertiary" />
          </span>
          <span className="block max-w-[200px] truncate text-[0.75rem]/[1.0125rem] font-normal text-tertiary">
            {view !== "chat"
              ? VIEW_SUBTITLES[view]
              : `${activeProject ? `${activeProject.name} · ` : ""}${activeChat?.title ?? (messages.length ? "New chat" : "Nothing saved yet")}`}
          </span>
        </button>
        {incognito ? (
          <span className="flex h-11 w-8 shrink-0 items-center justify-center text-accent" title="Incognito — this chat is not saved">
            <Ghost size={19} strokeWidth={1.8} />
          </span>
        ) : null}
        {/* Chat actions before New chat: the trailing button is the one under
            the thumb, and starting a new chat is the more frequent and more
            destructive of the two, so it takes the outer, deliberate position. */}
        <button
          type="button"
          onClick={() => {
            haptic("impact-light", preferences.haptics);
            if (messages.length > 0 && activeChat) setChatMenuOpen(true);
            else setSettingsOpen(true);
          }}
          aria-label={messages.length > 0 && activeChat ? "Chat actions" : "Settings"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-2"
        >
          <Ellipsis size={20} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={newChat}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-2"
          aria-label="New chat"
        >
          <SquarePen size={20} strokeWidth={1.8} />
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
      ) : /* No research banner.
             It was the only place the state was visible, so it earned its
             stripe across the top. Now the composer carries a research toggle
             that lights up when it is on — right where the request is typed,
             which is where the state matters — and the banner became a second
             announcement of something already on screen, pushing the
             conversation down to say it. One indicator, at the point of use. */
        preferences.connectedMcpServers.length ? (
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
              <div className="mt-4 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-4" role="alert">
                <p className="text-[0.8125rem]/[1.125rem] font-medium text-primary">{error.message || "That didn't go through. Tap to retry."}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={retry} className="min-h-11 rounded-xl bg-accent px-4 text-[0.8125rem]/[1.125rem] font-semibold text-white active:bg-accent-pressed">Try again</button>
                  <button type="button" onClick={clearError} className="min-h-11 rounded-xl px-4 text-[0.8125rem]/[1.125rem] font-semibold text-secondary active:bg-elev-3">Dismiss</button>
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

      {/* The composer belongs to the conversation, not to the app. On Files,
          Images and Tools there is nothing to send, and a dock sitting under a
          list of files invites a message that would go to the wrong place. */}
      {view !== "chat" ? null : (
        <>
      {attachmentError ? (
        <div className="mx-4 mb-1 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 px-3 py-2 text-center text-[0.75rem]/4 font-medium text-warning" role="alert">{attachmentError}</div>
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
        /* The same array the drawer renders, so the two cannot disagree. */
        localChatCount={chats.length}
        onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }}
        onPreferences={updatePreferences}
        onOpenConnectors={() => setConnectorsOpen(true)}
        onClearData={() => void clearData()}
        onExport={exportData}
      />

      <ModeSheet
        open={modeSheetOpen}
        preferences={preferences}
        onClose={() => setModeSheetOpen(false)}
        onPreferences={updatePreferences}
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
