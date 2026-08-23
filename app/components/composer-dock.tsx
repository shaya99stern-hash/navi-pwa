"use client";

import {
  AudioLines,
  ArrowUp,
  BookOpen,
  Camera,
  ChevronDown,
  FileText,
  Globe,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Check,
  FolderKanban,
  Link2,
  Square,
  Volume2,
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
import {
  describeRecordingSupport,
  MAX_RECORDING_SECONDS,
  startRecording,
  type AutoStopReason,
  type RecordingSession
} from "@/lib/ui/recorder";
import { IntegrationsSheet, type IntegrationStatus } from "./integrations-sheet";
import type { VoiceConversation } from "@/lib/ui/voice-conversation";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";
import { useOverlayRoute } from "@/lib/ui/overlay-route";
import { watchProviderStatus } from "@/lib/ui/provider-status";
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

/**
 * The waveform is a record of what was heard, not a decoration.
 *
 * It used to be fifteen fixed weights driven through a sine of the elapsed
 * second — so it moved identically whether the microphone was picking up a
 * voice or picking up nothing, which is precisely the question the person
 * watching it is asking. Now each bar is the loudest moment of a real 60ms
 * window and they scroll leftwards, which makes silence look like silence and
 * a dead microphone look dead.
 */
const WAVEFORM_BAR_COUNT = 34;
const WAVEFORM_BAR_MS = 60;

/* Fixed per-bar weights for the conversation strip, where the row is short and
   there is no scrolling history to show — only whether the microphone is
   hearing anything right now. The height comes from the live level; these vary
   the shape so it reads as a voice rather than a block. */
const CONVERSATION_BARS = [0.55, 0.85, 1, 0.7, 1, 0.8, 0.6];

/**
 * The loop's state, said plainly.
 *
 * Every phase gets a line, including the ones that pass in under a second.
 * A conversation where the screen goes blank between speaking and hearing is
 * one where nobody can tell a pause from a failure, and the phase is the only
 * thing that answers that.
 */
const CONVERSATION_PLACEHOLDER: Record<VoiceConversation["phase"], string> = {
  off: "",
  listening: "Listening — just talk",
  transcribing: "Writing that down…",
  thinking: "Navi Soul is thinking…",
  speaking: "Answering — the mic reopens after"
};

const menuRow = "flex min-h-[50px] w-full items-center gap-3 px-4 text-left text-[0.9375rem]/[1.375rem] font-medium text-primary active:bg-elev-3";

type Props = {
  value: string;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  effortLabel: string;
  hasMessages: boolean;
  research: boolean;
  /**
   * Code mode, which is a routing preference for the next message and nothing
   * more.
   *
   * It lives here, beside Effort and Research, because that is what it is: a
   * per-message dial. It used to hold the header's dominant line — the position
   * every other screen uses to say *where you are* — while behaving as a
   * setting, so switching it changed the title and not the conversation, and
   * opening an old chat relabelled it retroactively with a mode it was never
   * held in.
   */
  codeMode: boolean;
  onToggleCode: () => void;
  offlineCommand: boolean;
  haptics: boolean;
  voiceLanguage: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onOpenEffort: () => void;
  /** The spoken conversation, owned by the shell and driven from here. */
  conversation: VoiceConversation;
  onToggleResearch: () => void;
  onOpenTools: () => void;
  onOpenProjects: () => void;
  onOpenConnectors: () => void;
  connectorCount: number;
  connectorAccessMode: ConnectorAccessMode;
  onOpenPlaybooks: () => void;
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
  codeMode,
  onToggleCode,
  offlineCommand,
  haptics,
  voiceLanguage,
  inputRef,
  onChange,
  onSend,
  onStop,
  onFiles,
  onOpenEffort,
  conversation,
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

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const publish = () => {
      document.documentElement.style.setProperty("--navi-composer-height", `${Math.round(dock.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--navi-composer-height");
    };
  }, []);

  const loggedSupport = useRef(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /**
   * The transcript as it arrives, which is now during the recording rather
   * than after it.
   *
   * Kept apart from the draft until the recording is accepted. The words
   * appear in the composer as they are spoken — that is the whole point — but
   * they are a preview until then, so discarding a recording actually
   * discards it instead of leaving half a sentence behind in the box.
   */
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
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

  const valueRef = useRef(value);
  valueRef.current = value;
  /* Levels arrive fifty times a second. Held in refs and drained on an
     animation frame, because fifty React renders a second to move a row of
     bars is measurable on a phone — and the bars only refresh sixty times a
     second anyway. */
  const peakRef = useRef(0);
  const waveformRef = useRef<number[]>([]);
  const sourceSheet = useSheetDrag({ open: sourceMenuOpen, onDismiss: () => setSourceMenuOpen(false), haptics });

  useOverlayRoute({ open: sourceMenuOpen, onClose: () => setSourceMenuOpen(false) });
  useOverlayRoute({ open: integrationsOpen, onClose: () => setIntegrationsOpen(false) });

  const commands: Skill[] = value.startsWith("/") && !value.includes("\n") ? suggest(value, 6) : [];
  const showCommands = commands.length > 0 && focused;

  /**
   * The draft as it will read if this recording is kept.
   *
   * Shown in the composer itself rather than in a panel above it, because
   * that is where the text is going to end up and watching it land there is
   * what makes dictation feel like typing rather than like filing a request.
   * Read-only while it is a preview: an editable box whose contents are being
   * rewritten underneath the caret is a box that eats what you type.
   *
   * It stays out of `value` until the recording is accepted, which is what
   * makes discarding one an actual discard rather than an undo.
   */
  const dictating = listening || transcribing;
  /**
   * The spoken conversation is running, which is a different thing from
   * dictation and mutually exclusive with it.
   *
   * Dictation puts words in the box for someone to read and send. A
   * conversation sends them itself and answers out loud. Two microphones open
   * at once would fight over the device and transcribe the same sentence
   * twice, so each disables the other's button rather than trusting nobody to
   * press both.
   */
  const talking = conversation.active;
  /* What the box shows. In a conversation the words are not going into the
     draft at all — the turn is sent as soon as the pause lands — so they are
     shown in the same place for the same reason and then they are gone. */
  const previewValue = talking
    ? conversation.transcript
    : dictating && liveTranscript
      ? `${value}${value.trim() ? " " : ""}${liveTranscript}`
      : value;

  function completeCommand(skill: Skill) {
    haptic("selection", haptics);
    onChange(`${skill.triggers.slash} `);
    textareaRef.current?.focus();
  }

  useEffect(() => {
    setTouchKeyboard(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  /* Measured against what is displayed, not against the draft. While dictation
     is running the box shows the live transcript, and sizing to `value` would
     leave a growing paragraph scrolled out of sight inside a one-line box. */
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(168, Math.max(28, textarea.scrollHeight))}px`;
  }, [previewValue]);

  useEffect(() => {
    if (attachmentCount === 0) {
      setSelectedFiles([]);
      setAttachmentMessage(null);
      return;
    }
    setSelectedFiles((current) => current.slice(0, attachmentCount));
  }, [attachmentCount]);

  useEffect(() => watchProviderStatus((data) => {
    if (!data) {
      setProviderReady(null);
      return;
    }
    setProviderReady(Object.values(data.providers ?? {}).some(Boolean));
    setIntegrations({
      github: Boolean(data.devTools?.github),
      vercel: Boolean(data.devTools?.vercel),
      search: { configured: Boolean(data.search?.configured), provider: data.search?.provider ?? null },
      loaded: true
    });
  }), []);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  const available = providerReady !== false;
  const canSend = (online || offlineCommand) && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = false;
  const hiddenAttachmentCount = Math.max(0, attachmentCount - selectedFiles.length);

  const placeholder = attachmentCount
    ? "Add instructions for these files"
    : hasMessages ? "Write a message…" : "How can I help you today?";

  /**
   * Which voice is talking, said out loud on the one screen where it matters.
   *
   * Silence had four causes that looked the same from both sides. Naming the
   * engine means the answer to "why can I not hear it" is on screen the moment
   * it happens, rather than something to be inferred from server logs
   * afterwards — and if the premium voice is quietly unconfigured, that stops
   * being a mystery and becomes a sentence.
   */
  const spokenBy = conversation.voice && conversation.phase === "speaking"
    ? conversation.voice.engine === "premium"
      ? "Answering in the premium voice"
      : conversation.voice.engine === "device"
        ? `Answering in this device's voice — ${conversation.voice.why}`
        : `No voice available — ${conversation.voice.why}`
    : null;

  const footer = conversation.error
    ?? (talking ? `${spokenBy ?? CONVERSATION_PLACEHOLDER[conversation.phase]} · tap the waveform to end` : null)
    ?? (transcribing ? "Transcribing…" : null)
    ?? voiceMessage
    ?? attachmentMessage
    ?? (!online && !offlineCommand
      ? "Offline · your draft is saved locally"
      : !available
        ? "Add an AI provider key in Vercel to enable replies"
        : attachmentCount
          ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready`
          : null);

  const footerTone = conversation.error
    ? "text-warning"
    : talking || transcribing
      ? "text-accent"
      : !online || !available || voiceMessage || attachmentMessage ? "text-warning" : "text-tertiary";

  /* Counts up rather than down. The old clock counted towards a sixty-second
     ceiling that existed because a whole recording had to fit in one request;
     nothing is held whole now, so there is no deadline to show and a deadline
     shown is a thought cut short. */
  useEffect(() => {
    if (!listening) { setRecordedSeconds(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setRecordedSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [listening]);

  /* One place the waveform advances, at the display's own rate. A bar is the
     peak of the window it covers rather than the last sample in it, so a
     short loud syllable cannot fall between two frames and vanish. */
  useEffect(() => {
    if (!listening) {
      waveformRef.current = [];
      peakRef.current = 0;
      setWaveform([]);
      return;
    }
    let frame = 0;
    let lastBar = 0;
    const tick = (now: number) => {
      if (now - lastBar >= WAVEFORM_BAR_MS) {
        lastBar = now;
        waveformRef.current = [...waveformRef.current, peakRef.current].slice(-WAVEFORM_BAR_COUNT);
        setWaveform(waveformRef.current);
        peakRef.current = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [listening]);

  function send() {
    if ((!value.trim() && attachmentCount === 0) || generating) return;
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

  async function startVoice() {
    setVoiceMessage(null);
    setLiveTranscript("");
    haptic("selection", haptics);

    if (!loggedSupport.current) {
      loggedSupport.current = true;
      const supportInfo = describeRecordingSupport();
      console.info("NaviOS recording support:", supportInfo);
    }

    try {
      const session = await startRecording({
        /* Recorded into a ref rather than into state; the effect above turns
           it into bars at the display's rate. */
        onLevel: (level) => { peakRef.current = Math.max(peakRef.current, level); },
        onSpeaking: setSpeaking,
        /* The words, while they are still being said. Each call is the whole
           transcript so far and it only ever grows, so this can be rendered
           straight through without the text reordering itself as later pieces
           of the recording come back. */
        onTranscript: setLiveTranscript,
        onError: (message) => setVoiceMessage(message),
        onAutoStop: (reason: AutoStopReason) => {
          /* Only two of these can reach the composer: the fifteen-minute
             safety stop, and the microphone being taken away by a call or
             another app. Both mean "this recording is over" rather than "this
             recording is lost" — everything up to the interruption has
             already been transcribed, so it is finished rather than
             discarded. */
          if (reason === "too-long") {
            setVoiceMessage(`Recording stopped at ${Math.round(MAX_RECORDING_SECONDS / 60)} minutes. Keeping what you said.`);
          }
          void finishVoice();
        },
        language: voiceLanguage
      });
      recorderRef.current = session;
      setListening(true);
    } catch (error) {
      setListening(false);
      setSpeaking(false);
      setTranscribing(false);

      /* Whatever the recorder threw, said as it was thrown. It already tells a
         refused permission apart from a missing device, and an installed iOS
         app apart from a browser tab — replacing that with a generic line here
         would throw away the only part of the message that names the remedy. */
      setVoiceMessage(error instanceof Error ? error.message : "Recording could not start.");
    }
  }

  async function finishVoice() {
    const session = recorderRef.current;
    recorderRef.current = null;
    if (!session) {
      setListening(false);
      setSpeaking(false);
      setTranscribing(false);
      return;
    }

    setListening(false);
    setSpeaking(false);
    setTranscribing(true);
    haptic("selection", haptics);

    try {
      /* Usually a short wait now, and often none at all: everything up to the
         last pause has been transcribing while the person was still talking,
         so this only has to finish the final segment. */
      const text = await session.stop();
      if (text) {
        const current = valueRef.current;
        onChange(`${current}${current.trim() ? " " : ""}${text}`);
        textareaRef.current?.focus();
      } else {
        setVoiceMessage("Nothing was picked up.");
      }
    } catch (error) {
      setVoiceMessage(error instanceof Error ? error.message : "That recording could not be transcribed.");
    } finally {
      setTranscribing(false);
      setLiveTranscript("");
    }
  }

  function cancelVoice() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setSpeaking(false);
    /* The preview goes with it. It was never written into the draft, so
       discarding is a discard rather than an undo. */
    setLiveTranscript("");
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
              value={previewValue}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={keyDown}
              onPaste={paste}
              onFocus={() => {
                setFocused(true);
                window.setTimeout(() => textareaRef.current?.scrollIntoView({ block: "nearest" }), 120);
              }}
              onBlur={() => setFocused(false)}
              rows={1}
              enterKeyHint="enter"
              inputMode="text"
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              disabled={blocked}
              readOnly={dictating || talking}
              placeholder={talking ? CONVERSATION_PLACEHOLDER[conversation.phase] : listening ? "Listening — speak naturally" : placeholder}
              aria-label="Chat with Navi Soul"
              data-navi-composer=""
              className="max-h-[168px] min-h-11 w-full overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[1rem]/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
            />

            <div className="mt-0.5 flex min-h-11 items-center gap-0.5 px-1 pb-1">
              {listening || talking ? null : (
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
              )}

              {listening || talking ? null : (
              <button
                type="button"
                role="switch"
                aria-checked={research}
                onClick={() => { haptic("selection", haptics); onToggleResearch(); }}
                disabled={blocked || generating}
                className="composer-action"
                aria-label={research ? "Research is on. Turn it off" : "Research is off. Turn it on"}
              >
                <Globe size={19} strokeWidth={1.8} className={research ? "text-orange-500" : ""} />
              </button>
              )}

              {listening || talking ? null : (
              <button
                type="button"
                onClick={onOpenEffort}
                className="flex min-h-9 min-w-0 max-w-[180px] items-center gap-1 rounded-full px-2 text-[0.8125rem]/4 active:bg-elev-2"
                aria-label={`Effort: ${effortLabel}. Change effort`}
              >
                <span className="truncate font-semibold text-primary">{effortLabel}</span>
                <ChevronDown size={13} className="shrink-0 text-tertiary" />
              </button>
              )}

              {listening || talking ? null : <span className="min-w-0 flex-1" />}

              {talking ? (
                <span
                  /* The conversation's own strip. It shares the dictation
                     strip's shape on purpose — same ring, same bars, same
                     place — because they are the same act from the person's
                     side, and only the ending differs. */
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1 ring-1 transition-colors duration-150 ${conversation.hearing ? "ring-accent" : "ring-transparent"}`}
                  role="status"
                  aria-label={CONVERSATION_PLACEHOLDER[conversation.phase]}
                >
                  <button
                    type="button"
                    onClick={conversation.stop}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
                    aria-label="End the voice conversation"
                  >
                    <X size={17} strokeWidth={2} />
                  </button>
                  <span className="flex h-6 min-w-0 flex-1 items-end justify-center gap-1" aria-hidden="true">
                    {CONVERSATION_BARS.map((weight, index) => (
                      <span
                        key={index}
                        className={`w-1.5 rounded-full transition-[height,background-color] duration-100 ${conversation.hearing ? "bg-accent" : "bg-[var(--border-strong)]"}`}
                        style={{ height: `${Math.max(4, Math.min(22, 4 + conversation.level * weight * 26))}px` }}
                      />
                    ))}
                  </span>
                  {/* Which of the four things is happening. The bars only
                      answer that while the microphone is open; between the
                      pause and the answer they are flat, and flat is exactly
                      what a broken microphone looks like. */}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent">
                    {conversation.phase === "speaking"
                      ? <Volume2 size={17} />
                      : conversation.phase === "listening"
                        ? <AudioLines size={17} />
                        : <LoaderCircle size={17} className="animate-spin" />}
                  </span>
                </span>
              ) : listening ? (
                <span
                  /* The detector's own answer, not a level threshold read off
                     the bars. It is the same judgement that decides where a
                     segment is cut, so the ring lighting up means the words
                     inside it are on their way — and a ring that never lights
                     is the clearest possible statement that the microphone is
                     open but hearing nothing. */
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1 ring-1 transition-colors duration-150 ${speaking ? "ring-accent" : "ring-transparent"}`}
                  role="status"
                  aria-label={speaking ? "Listening, speech detected" : "Listening"}
                >
                  <button
                    type="button"
                    onClick={cancelVoice}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
                    aria-label="Discard recording"
                  >
                    <X size={17} strokeWidth={2} />
                  </button>
                  <span className="flex min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden="true">
                    {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
                      /* Right-aligned and padded on the left, so the first
                         bars scroll in from the empty side instead of the row
                         growing outwards from the middle. */
                      const offset = index - (WAVEFORM_BAR_COUNT - waveform.length);
                      const level = offset >= 0 ? waveform[offset] : 0;
                      const height = Math.max(3, Math.round(3 + level * 19));
                      return (
                        <span
                          key={index}
                          className={`w-[3px] shrink-0 rounded-full transition-[height,background-color] duration-100 ${level > 0.02 ? "bg-accent" : "bg-[var(--border-strong)]"}`}
                          style={{ height: `${height}px` }}
                        />
                      );
                    })}
                  </span>
                  <span
                    className="shrink-0 tabular-nums text-[0.75rem]/4 font-semibold text-secondary"
                    aria-label={`Recording, ${recordedSeconds} seconds`}
                  >
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
                onClick={toggleVoice}
                disabled={blocked || generating || transcribing}
                className={`composer-action ${transcribing ? "opacity-60" : ""}`}
                aria-label={transcribing ? "Transcribing" : "Record a message"}
              >
                <Mic size={19} strokeWidth={1.8} />
              </button>
              )}
              {listening || talking ? null : (
              /* One tap and it is a conversation until it is ended: it
                 listens, you pause, it answers aloud, it listens again. This
                 used to open a sheet with a Start button, a Stop button, a
                 Send button and two switches between wanting to say something
                 and having said it. */
              <button
                type="button"
                onClick={conversation.toggle}
                disabled={blocked || generating || transcribing || !online}
                className="composer-action"
                aria-label="Start a voice conversation"
                aria-pressed={false}
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

          <div className="flex items-center justify-center px-3 text-center" role="status" aria-live="polite">
            {footer ? (
              <span className={`block max-h-8 overflow-hidden pt-1 text-[0.6875rem]/4 font-medium ${footerTone}`}>{footer}</span>
            ) : hasMessages ? (
              <span className="block pt-1 text-[0.6875rem]/4 font-medium text-tertiary">Navi Soul is AI and can make mistakes. Double-check important answers.</span>
            ) : null}
          </div>
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
              <button type="button" onClick={() => { setSourceMenuOpen(false); setIntegrationsOpen(true); }} className={menuRow}>
                <Link2 size={19} strokeWidth={1.8} className="shrink-0 text-secondary" />
                <span className="flex-1">Integrations</span>
                <ChevronDown size={16} className="-rotate-90 shrink-0 text-tertiary" />
              </button>

              <div className="h-2 bg-[var(--bg-app)]" aria-hidden="true" />

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={research}
                onClick={() => { haptic("selection", haptics); onToggleResearch(); }}
                className={menuRow}
              >
                <Globe size={19} strokeWidth={1.8} className={`shrink-0 ${research ? "text-orange-500" : "text-secondary"}`} />
                <span className="flex-1">Web search</span>
                {research ? <Check size={18} strokeWidth={2.2} className="shrink-0 text-orange-500" /> : null}
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
