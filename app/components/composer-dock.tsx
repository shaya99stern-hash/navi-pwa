"use client";

import {
  AudioLines,
  ArrowUp,
  BookOpen,
  Camera,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Check,
  FolderKanban,
  Link2,
  Search,
  Square,
  X
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { suggest, type Skill } from "@/lib/skills";
import type { ConnectorAccessMode } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";
import { startRecording, type RecordingSession } from "@/lib/ui/recorder";
import { IntegrationsSheet, type IntegrationStatus } from "./integrations-sheet";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";
import {
  ATTACHMENT_BUDGET,
  MAX_ATTACHMENTS,
  MAX_IMAGE_INPUT_BYTES,
  isResizableImage
} from "@/lib/ui/attachments";


const DOCUMENT_ACCEPT = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf"
].join(",");

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/* Fixed per-bar phase offsets for the recording waveform. Constant so the
   row keeps its shape across renders instead of reshuffling every frame. */
const WAVEFORM_BARS = [0.7, 1.3, 0.9, 1.7, 1.1, 0.6, 1.5, 0.8, 1.2, 1.6, 0.75, 1.35, 0.95, 1.45, 0.65];

/** Shared row shape for the + menu: icon, label, optional trailing mark. */
const menuRow = "flex min-h-[50px] w-full items-center gap-3 px-4 text-left text-[0.9375rem]/[1.375rem] font-medium text-primary active:bg-elev-3";

type Props = {
  value: string;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  /** Current effort level label, shown gray beside the model name in the pill. */
  effortLabel: string;
  /** Placeholder and disclaimer differ between a fresh chat and one under way. */
  hasMessages: boolean;
  research: boolean;
  /** The draft is a slash command, which runs on-device and needs no network. */
  offlineCommand: boolean;
  haptics: boolean;
  /** The voice-language preference, so dictation matches the voice sheet. */
  voiceLanguage: string;
  /** Lets the shell focus the composer synchronously from a tap handler. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onOpenEffort: () => void;
  onOpenVoice: () => void;
  onToggleResearch: () => void;
  onOpenTools: () => void;
  onOpenProjects: () => void;
  onOpenConnectors: () => void;
  /** For the Integrations sheet, which reports real state rather than guessing. */
  connectorCount: number;
  connectorAccessMode: ConnectorAccessMode;
  onOpenPlaybooks: () => void;
};

type ProviderStatus = {
  providers?: Record<string, boolean | undefined>;
  devTools?: { github?: boolean; vercel?: boolean };
  search?: { configured?: boolean; provider?: string | null };
};

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function AttachmentPreview({ file }: { file: File }) {
  const isImage = file.type.startsWith("image/");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="flex min-w-[154px] max-w-[210px] items-center gap-2 rounded-[16px] border border-[var(--border-subtle)] bg-elev-2 p-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-elev-3 text-secondary">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText size={18} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.75rem]/4 font-semibold text-primary">{file.name}</span>
        <span className="block text-[0.625rem]/4 font-medium text-tertiary">{formatBytes(file.size)}</span>
      </span>
    </div>
  );
}

export function ComposerDock({
  value,
  generating,
  online,
  attachmentCount,
  statusText,
  effortLabel,
  hasMessages,
  research,
  offlineCommand,
  haptics,
  voiceLanguage,
  inputRef,
  onChange,
  onSend,
  onStop,
  onFiles,
  onOpenEffort,
  onOpenVoice,
  onToggleResearch,
  onOpenTools,
  onOpenProjects,
  onOpenConnectors,
  connectorCount,
  connectorAccessMode,
  onOpenPlaybooks
}: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<RecordingSession | null>(null);
  /** True between pointerdown and pointerup on the mic, so a tap is distinguishable from a hold. */
  /** Seconds recorded, so the composer shows progress rather than a lit icon. */
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  /* Transcription is a visible state of its own: the recording has stopped
     but the words have not arrived, and a composer that looks idle for two
     seconds reads as having thrown the recording away. */
  const [transcribing, setTranscribing] = useState(false);
  /** Live microphone level, 0–1, for the waveform drawn while recording. */
  const [inputLevel, setInputLevel] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus>({
    github: false,
    vercel: false,
    search: { configured: false, provider: null },
    loaded: false
  });
  const [touchKeyboard, setTouchKeyboard] = useState(false);
  /* The draft as it stands right now. A recognition callback closes over the
     `value` from the render that started listening, so appending through the
     prop dropped anything typed while the microphone was open. */
  const valueRef = useRef(value);
  valueRef.current = value;
  const sourceSheet = useSheetDrag({ open: sourceMenuOpen, onDismiss: () => setSourceMenuOpen(false), haptics });

  /* 82 on-device commands are useless if nobody can find them, so typing a
     slash lists what it could still become. Ranking is a synchronous map
     lookup, cheap enough to run per keystroke. */
  const commands: Skill[] = value.startsWith("/") && !value.includes("\n") ? suggest(value, 6) : [];
  const showCommands = commands.length > 0 && focused;

  function completeCommand(skill: Skill) {
    haptic("selection", haptics);
    onChange(`${skill.triggers.slash} `);
    textareaRef.current?.focus();
  }

  useEffect(() => {
    setTouchKeyboard(window.matchMedia("(pointer: coarse)").matches);
  }, []);


  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(168, Math.max(28, textarea.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (attachmentCount === 0) {
      setSelectedFiles([]);
      setAttachmentMessage(null);
      return;
    }
    setSelectedFiles((current) => current.slice(0, attachmentCount));
  }, [attachmentCount]);

  useEffect(() => {
    let cancelled = false;

    const probeProviders = () => {
      void fetch("/api/models", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: ProviderStatus | null) => {
          if (cancelled) return;
          // A failed or unauthorized probe must not latch the UI into an error
          // state; treat it as unknown and let sending report the real result.
          if (!data) {
            setProviderReady(null);
            return;
          }
          const providers = data.providers;
          // Any configured provider can answer; which one is the router's business.
          setProviderReady(Object.values(providers ?? {}).some(Boolean));
          /* The same probe already tells us what Navi can reach, so the
             Integrations sheet costs no extra request. */
          setIntegrations({
            github: Boolean(data.devTools?.github),
            vercel: Boolean(data.devTools?.vercel),
            search: { configured: Boolean(data.search?.configured), provider: data.search?.provider ?? null },
            loaded: true
          });
        })
        .catch(() => {
          if (!cancelled) setProviderReady(null);
        });
    };

    probeProviders();

    // Re-probe on return so newly added provider keys are picked up without a
    // reinstall or hard reload.
    const recheck = () => {
      if (document.visibilityState === "visible") probeProviders();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
      recorderRef.current?.cancel();
    };
  }, []);

  const available = providerReady !== false;
  /* Typing, attaching, and dictating stay available even with no provider
     configured or no network. Disabling the textarea prevents focus entirely,
     which stops the on-screen keyboard from ever opening and makes the app
     look dead; only sending is gated, and the reason is shown below. */
  // A slash command is answered on this device, so being offline is no reason
  // to grey out the send button for one.
  const canSend = (online || offlineCommand) && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = false;
  const hiddenAttachmentCount = Math.max(0, attachmentCount - selectedFiles.length);

  const placeholder = attachmentCount
    ? "Add instructions for these files"
    : hasMessages ? "Write a message…" : "How can I help you today?";

  /* Idle status is deliberately empty: the thinking indicator in the thread
     already reports progress while generating. */
  /* The recording bar already shows the level and the clock, so the footer
     only speaks for the state that has no other indicator. */
  const footer = (transcribing ? "Transcribing…" : null)
    ?? voiceMessage
    ?? attachmentMessage
    ?? (!online && !offlineCommand
      ? "Offline · your draft is saved locally"
      : !available
        ? "Add an AI provider key in Vercel to enable replies"
        : attachmentCount
          ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready`
          : null);

  /* Recording is a live state, not a warning: it gets the accent, so the
     composer reads as working rather than as complaining. */
  const footerTone = transcribing
    ? "text-accent"
    : !online || !available || voiceMessage || attachmentMessage ? "text-warning" : "text-tertiary";

  /* A ticking timer while recording. A lit button says "something is on";
     a running clock says "you are being heard", which is the difference
     between trusting dictation and tapping it twice to check. */
  useEffect(() => {
    if (!listening) { setRecordedSeconds(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setRecordedSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [listening]);

  function send() {
    // Deliberately not gated on the provider probe: if it is wrong or stale the
    // request should still go out and surface a real server error.
    if ((!value.trim() && attachmentCount === 0) || generating) return;
    // Slash commands are computed on this device, so they send while offline.
    if (!online && !offlineCommand) return;
    setSending(true);
    setSourceMenuOpen(false);
    haptic("impact-light", haptics);
    window.setTimeout(() => setSending(false), 100);
    onSend();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // On touch keyboards Return inserts a newline, exactly like a native
    // messaging app; sending is the arrow button's job. Hardware keyboards
    // keep Enter-to-send with Shift+Enter for newlines.
    if (touchKeyboard) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function addSelectedFiles(files: FileList | null) {
    if (!files?.length) return;

    const known = new Set(selectedFiles.map(fileKey));
    const incoming = Array.from(files).filter((file) => !known.has(fileKey(file)));

    if (!incoming.length) {
      setAttachmentMessage("Those items are already attached.");
      haptic("warning", haptics);
      return;
    }

    const nextCount = attachmentCount + incoming.length;
    // Images get resized before sending, so only documents face the hard cap.
    const invalid = incoming.find(
      (file) => file.size > (isResizableImage(file) ? MAX_IMAGE_INPUT_BYTES : ATTACHMENT_BUDGET)
    );

    if (invalid) {
      setAttachmentMessage(`${invalid.name} is too large to send.`);
      haptic("warning", haptics);
      return;
    }

    if (nextCount > MAX_ATTACHMENTS) {
      setAttachmentMessage(`You can attach up to ${MAX_ATTACHMENTS} items at once.`);
      haptic("warning", haptics);
      return;
    }

    // Only what cannot be resized is checked against the budget here; the
    // send path resizes images and reports if the result still does not fit.
    const fixedBytes = [...selectedFiles, ...incoming]
      .filter((file) => !isResizableImage(file))
      .reduce((total, file) => total + file.size, 0);
    if (fixedBytes > ATTACHMENT_BUDGET) {
      setAttachmentMessage("Those documents exceed the request limit.");
      haptic("warning", haptics);
      return;
    }

    const transfer = new DataTransfer();
    incoming.forEach((file) => transfer.items.add(file));
    setSelectedFiles((current) => [...current, ...incoming].slice(0, MAX_ATTACHMENTS));
    setAttachmentMessage(null);
    setSourceMenuOpen(false);
    onFiles(transfer.files);
    haptic("selection", haptics);
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (!files?.length) return;
    addSelectedFiles(files);
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (blocked || generating) return;
    event.preventDefault();
    setDragActive(true);
  }

  function dragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    if (blocked || generating) return;
    event.preventDefault();
    setDragActive(false);
    addSelectedFiles(event.dataTransfer.files);
  }

  function openSourceMenu() {
    if (blocked || generating) return;
    setAttachmentMessage(null);
    setSourceMenuOpen(true);
    haptic("selection", haptics);
  }

  function openTools() {
    setSourceMenuOpen(false);
    haptic("selection", haptics);
    onOpenTools();
  }

  /**
   * Record, then transcribe.
   *
   * This used to drive `webkitSpeechRecognition`, which is why the microphone
   * "did not work at all": in an installed iOS PWA it is often absent with no
   * error and no event to render, so the button did nothing observable. It
   * also plays a system chime the page cannot suppress. Recording with
   * MediaRecorder works wherever getUserMedia does, is silent, and gives us
   * the audio level the waveform draws.
   */
  async function startVoice() {
    setVoiceMessage(null);
    try {
      const session = await startRecording({
        onLevel: (level) => setInputLevel(level),
        onError: (message) => setVoiceMessage(message)
      });
      recorderRef.current = session;
      setListening(true);
      haptic("selection", haptics);
    } catch (error) {
      setVoiceMessage(error instanceof Error ? error.message : "Recording could not start.");
      haptic("error", haptics);
    }
  }

  async function finishVoice() {
    const session = recorderRef.current;
    recorderRef.current = null;
    if (!session) return;

    setListening(false);
    setInputLevel(0);
    setTranscribing(true);
    haptic("selection", haptics);
    try {
      const text = await session.stop();
      if (text) {
        /* Read through the ref so the transcript joins the draft as it stands
           now, not as it stood when recording began. */
        const current = valueRef.current;
        onChange(`${current}${current.trim() ? " " : ""}${text}`);
        textareaRef.current?.focus();
      } else {
        setVoiceMessage("Nothing was recorded.");
      }
    } catch (error) {
      setVoiceMessage(error instanceof Error ? error.message : "That recording could not be transcribed.");
      haptic("error", haptics);
    } finally {
      setTranscribing(false);
    }
  }

  function cancelVoice() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setInputLevel(0);
    setVoiceMessage(null);
    haptic("selection", haptics);
  }

  function toggleVoice() {
    if (transcribing) return;
    if (listening) void finishVoice();
    else void startVoice();
  }

  return (
    <>
      <div
        ref={dockRef}
        className={`navi-composer-dock relative z-40 shrink-0 border-t transition-colors duration-150 ${dragActive ? "border-accent bg-[var(--selection-bg)]" : "border-[var(--border-subtle)]"}`}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        <div className="mx-auto w-full max-w-app">
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              addSelectedFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              addSelectedFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={documentInputRef}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              addSelectedFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          {dragActive ? (
            <div className="mb-2 flex min-h-12 items-center justify-center rounded-2xl border border-dashed border-accent bg-elev-2 px-3 text-[0.75rem]/4 font-semibold text-primary">
              Drop files here to attach them
            </div>
          ) : null}

          {attachmentCount ? (
            <div className="mb-2 flex items-center gap-2 overflow-x-auto px-0.5 pb-0.5 scrollbar-none" aria-label="Pending attachments">
              {selectedFiles.map((file, index) => (
                <AttachmentPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} />
              ))}
              {hiddenAttachmentCount ? (
                <button
                  type="button"
                  onClick={openTools}
                  className="flex min-h-[56px] min-w-[132px] items-center justify-center rounded-[16px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[0.75rem]/4 font-semibold text-secondary active:bg-elev-3"
                >
                  +{hiddenAttachmentCount} more
                </button>
              ) : null}
              <button
                type="button"
                onClick={openTools}
                className="min-h-[56px] shrink-0 rounded-[16px] px-3 text-[0.75rem]/4 font-semibold text-secondary active:bg-elev-2"
                aria-label="Manage or clear attachments"
              >
                Manage
              </button>
            </div>
          ) : null}

          {showCommands ? (
            <div
              role="listbox"
              aria-label="Commands"
              className="mb-1.5 overflow-hidden rounded-card border border-[var(--border-subtle)] bg-elev-1 shadow-menu"
            >
              {commands.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  // Pointer-down beats blur, which would close the list first.
                  onPointerDown={(event) => { event.preventDefault(); completeCommand(skill); }}
                  className="flex min-h-[52px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-3 text-left last:border-b-0 active:bg-elev-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem]/5 font-semibold text-primary">{skill.triggers.slash}</span>
                    <span className="block truncate text-[0.75rem]/4 font-medium text-tertiary">{skill.description}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-elev-2 px-2 py-0.5 text-[0.625rem]/4 font-semibold uppercase tracking-wide text-tertiary">
                    on device
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={submit}
            data-focused={focused ? "true" : "false"}
            className={`navi-composer flex flex-col p-2 ${sending ? "scale-[0.985]" : "scale-100"}`}
          >
            <textarea
              ref={(node) => {
                textareaRef.current = node;
                if (inputRef) inputRef.current = node;
              }}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={keyDown}
              onPaste={paste}
              onFocus={() => {
                setFocused(true);
                window.setTimeout(() => textareaRef.current?.scrollIntoView({ block: "nearest" }), 120);
              }}
              onBlur={() => setFocused(false)}
              rows={1}
              /* Always request the plain Return key: rendering this after
                 hydration left the server's value in place, so iOS kept
                 showing the send/checkmark key. Hardware keyboards still send
                 on Enter via the keydown handler, where the hint is unused. */
              enterKeyHint="enter"
              inputMode="text"
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              disabled={blocked}
              placeholder={placeholder}
              aria-label="Chat with NaviSoul"
              /* Stable hook for anything that needs to prefill the composer
                 from outside React — the artifact frame's edit button, for
                 one. Keying off the aria-label coupled that to copy, and the
                 copy changed. */
              data-navi-composer=""
              className="max-h-[168px] min-h-11 w-full overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[1rem]/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
            />

            <div className="mt-0.5 flex min-h-11 items-center gap-0.5 px-1 pb-1">
              <button
                type="button"
                onClick={openSourceMenu}
                disabled={blocked || generating}
                className="composer-action"
                aria-label="Add photos, camera, and files"
                aria-expanded={sourceMenuOpen}
              >
                <Plus size={22} strokeWidth={1.8} />
              </button>

              <button
                type="button"
                onClick={onOpenEffort}
                className="flex min-h-9 min-w-0 max-w-[180px] items-center gap-1 rounded-full px-2 text-[0.8125rem]/4 active:bg-elev-2"
                /* Effort only. There is one brain, so a model name here would
                   be offering an implementation detail as a choice. */
                aria-label={`Effort: ${effortLabel}. Change effort`}
              >
                <span className="truncate font-semibold text-primary">{effortLabel}</span>
                <ChevronDown size={13} className="shrink-0 text-tertiary" />
              </button>

              {/* Research, in the composer where it is decided.
                  It lived one level down inside the plus menu, so turning
                  search on for the next question meant opening a sheet to
                  find a checkbox — for the control most likely to change
                  between one message and the next. It sits beside effort
                  because they are the same kind of choice: how this message
                  should be answered. */}
              <button
                type="button"
                role="switch"
                aria-checked={research}
                onClick={() => { haptic("selection", haptics); onToggleResearch(); }}
                disabled={blocked || generating}
                className={`flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2 text-[0.8125rem]/4 active:bg-elev-2 ${research ? "bg-[var(--selection-bg)]" : ""}`}
                aria-label={research ? "Research is on. Turn it off" : "Research is off. Turn it on"}
              >
                <Search size={16} strokeWidth={1.8} className={`shrink-0 ${research ? "text-accent" : "text-secondary"}`} />
                <span className={`font-semibold ${research ? "text-accent" : "text-secondary"}`}>Research</span>
              </button>

              <span className="min-w-0 flex-1" />

              {/* Mic and voice mode stay put while typing — the send button
                  joins them instead of replacing them, so nothing under a
                  finger disappears mid-thought. Both are icon-weight peers. */}
              {/* While recording, the mic and voice buttons give way to a
                  cancel / waveform / confirm bar. A lit icon says "something
                  is on"; a moving waveform says "you are being heard", which
                  is the difference between trusting dictation and tapping it
                  twice to check. */}
              {listening ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1">
                  <button
                    type="button"
                    onClick={cancelVoice}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
                    aria-label="Discard recording"
                  >
                    <X size={17} strokeWidth={2} />
                  </button>
                  <span className="flex min-w-0 flex-1 items-center justify-center gap-[3px]" aria-hidden="true">
                    {WAVEFORM_BARS.map((seed, index) => {
                      /* Each bar reacts to the live level with its own phase,
                         so the row moves like sound rather than pulsing as a
                         block. Idle level leaves a row of dots. */
                      const wave = 0.35 + 0.65 * Math.abs(Math.sin((recordedSeconds * 4 + index) * seed));
                      const height = Math.max(3, Math.round(3 + inputLevel * wave * 19));
                      return (
                        <span
                          key={index}
                          className="w-[3px] shrink-0 rounded-full bg-accent transition-[height] duration-100"
                          style={{ height: `${height}px` }}
                        />
                      );
                    })}
                  </span>
                  <span className="shrink-0 tabular-nums text-[0.75rem]/4 font-semibold text-secondary">
                    {Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[var(--accent-on-primary)] active:bg-accent-pressed"
                    aria-label="Stop recording and transcribe"
                  >
                    <Check size={17} strokeWidth={2.4} />
                  </button>
                </span>
              ) : (
              <button
                type="button"
                /* Tap to start, tap to stop.
                 *
                 * This was press-and-hold: pointerdown started recording and
                 * pointerup stopped it. A normal tap is a pointerdown and a
                 * pointerup a few milliseconds apart, so tapping the mic
                 * started and instantly stopped it — the button did nothing at
                 * all unless you held it perfectly still for the whole
                 * sentence, and any scroll or permission prompt cancelled the
                 * gesture. Toggling is also what a phone user actually expects
                 * from a dictation button, and it leaves the hand free. */
                onClick={toggleVoice}
                disabled={blocked || generating || transcribing}
                className={`composer-action ${transcribing ? "opacity-60" : ""}`}
                aria-label={transcribing ? "Transcribing" : "Record a message"}
              >
                <Mic size={19} strokeWidth={1.8} />
              </button>
              )}
              {listening ? null : (
              <button
                type="button"
                onClick={onOpenVoice}
                disabled={blocked || generating}
                className="composer-action"
                aria-label="Use voice mode"
              >
                <AudioLines size={19} strokeWidth={1.8} />
              </button>
              )}
              {value.trim() || attachmentCount || generating ? (
                <button
                  type={generating ? "button" : "submit"}
                  onClick={generating ? onStop : undefined}
                  disabled={!generating && !canSend}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-accent text-[var(--accent-on-primary)] shadow-sm active:scale-95 active:bg-accent-pressed" : "bg-elev-3 text-disabled"}`}
                  aria-label={generating ? "Stop response" : "Send message"}
                >
                  {generating ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
                </button>
              ) : null}
            </div>
          </form>

          {/* Actionable warnings first; otherwise, once a conversation is under
              way, the standing accuracy disclaimer takes this line. */}
          <div className="flex items-center justify-center px-3 text-center" role="status" aria-live="polite">
            {footer ? (
              <span className={`block pt-1 text-[0.6875rem]/4 font-medium ${footerTone}`}>{footer}</span>
            ) : hasMessages ? (
              <span className="block pt-1 text-[0.6875rem]/4 font-medium text-tertiary">NaviSoul is AI and can make mistakes. Double-check important answers.</span>
            ) : null}
          </div>

          {/* Starter chips on a fresh chat only; they seed the draft and hand
              focus back so the keyboard stays up. */}
          {!hasMessages && !value.trim() && !attachmentCount && !generating ? (
            <div className="scrollbar-none -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {/* "Visualize" seeds a phrasing the server's image-intent matcher
                  already recognises, so the chip lands in the real image
                  pipeline rather than a text description of a picture. */}
              {[
                ["Write", "Write a "],
                ["Learn", "Explain how "],
                ["Visualize", "Visualize "],
                ["Plan", "Help me plan "],
                ["Code", "Write code that "]
              ].map(([label, starter]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    haptic("selection", haptics);
                    onChange(starter);
                    textareaRef.current?.focus();
                  }}
                  className="h-9 shrink-0 rounded-full border border-[var(--border-subtle)] bg-elev-1 px-4 text-[0.8125rem]/5 font-medium text-secondary active:bg-elev-2"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {sourceMenuOpen ? (
        <div className="fixed inset-0 z-[85]">
          <button
            type="button"
            aria-label="Close attachment menu"
            onClick={() => setSourceMenuOpen(false)}
            {...sourceSheet.scrimProps}
            className="absolute inset-0 bg-overlay backdrop-blur-[3px]"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Add to message"
            {...sourceSheet.sheetProps}
            className="navi-sheet absolute inset-x-0 bottom-0 mx-auto w-full max-w-app px-gutter pb-[calc(18px+var(--safe-bottom))] pt-1"
          >
            <div {...sourceSheet.handleProps} className="navi-sheet-grab mb-1 pt-1"><div className="navi-sheet-grabber" /></div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[1.0625rem]/6 font-semibold text-primary">Add to message</div>
                <div className="text-[0.75rem]/4 font-medium text-tertiary">Up to six items · photos are resized to fit</div>
              </div>
              <button
                type="button"
                onClick={() => setSourceMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* A list, not a grid of tiles: the actions here are of different
                kinds — attach, navigate, toggle — and a grid implies they are
                all the same kind of thing. Dividers group them. */}
            <div className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-elev-2">
              <button type="button" onClick={() => imageInputRef.current?.click()} className={menuRow}>
                <ImageIcon size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Add photos</span>
              </button>
              <button type="button" onClick={() => cameraInputRef.current?.click()} className={menuRow}>
                <Camera size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Take a photo</span>
              </button>
              <button type="button" onClick={() => documentInputRef.current?.click()} className={menuRow}>
                <Paperclip size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Add files</span>
              </button>
              <button type="button" onClick={() => { setSourceMenuOpen(false); onOpenProjects(); }} className={menuRow}>
                <FolderKanban size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Add to project</span>
                <ChevronDown size={16} className="-rotate-90 shrink-0 text-tertiary" />
              </button>

              <div className="h-2 bg-[var(--bg-app)]" aria-hidden="true" />

              <button type="button" onClick={() => { setSourceMenuOpen(false); onOpenPlaybooks(); }} className={menuRow}>
                <BookOpen size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Playbooks</span>
                <ChevronDown size={16} className="-rotate-90 shrink-0 text-tertiary" />
              </button>
              {/* Integrations replaces what would otherwise be a row of loose
                  icons for GitHub, Vercel, search, and connectors. One entry,
                  one sheet, and nothing added to the main interface. */}
              <button type="button" onClick={() => { setSourceMenuOpen(false); setIntegrationsOpen(true); }} className={menuRow}>
                <Link2 size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Integrations</span>
                <ChevronDown size={16} className="-rotate-90 shrink-0 text-tertiary" />
              </button>

              <div className="h-2 bg-[var(--bg-app)]" aria-hidden="true" />

              {/* A checkable row, not a switch: it reads as "this is on for the
                  next message" rather than as a settings change. */}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={research}
                onClick={() => { haptic("selection", haptics); onToggleResearch(); }}
                className={menuRow}
              >
                <Search size={19} strokeWidth={1.8} className={`shrink-0 ${research ? "text-accent" : "text-secondary"}`} />
                <span className="flex-1">Web search</span>
                {research ? <Check size={18} strokeWidth={2.2} className="shrink-0 text-accent" /> : null}
              </button>
            </div>

            <p className="mt-2.5 px-1 text-center text-[0.6875rem]/4 font-medium text-tertiary">
              You can also paste a screenshot or drag files onto the composer.
            </p>
          </section>
        </div>
      ) : null}

      <IntegrationsSheet
        open={integrationsOpen}
        status={integrations}
        connectorCount={connectorCount}
        connectorAccessMode={connectorAccessMode}
        haptics={haptics}
        onClose={() => setIntegrationsOpen(false)}
        onOpenConnectors={() => { setIntegrationsOpen(false); onOpenConnectors(); }}
      />
    </>
  );
}
