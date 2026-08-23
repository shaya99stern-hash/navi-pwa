"use client";

import {
  AudioLines,
  ArrowUp,
  ChevronDown,
  FileText,
  LoaderCircle,
  Mic,
  Plus,
  Check,
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
import type { VoiceConversation } from "@/lib/ui/voice-conversation";
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
const COMBINED_ACCEPT = `${IMAGE_ACCEPT},${DOCUMENT_ACCEPT}`;

const WAVEFORM_BAR_COUNT = 34;
const WAVEFORM_BAR_MS = 60;
const CONVERSATION_BARS = [0.55, 0.85, 1, 0.7, 1, 0.8, 0.6];

const CONVERSATION_PLACEHOLDER: Record<VoiceConversation["phase"], string> = {
  off: "",
  listening: "Listening — just talk",
  transcribing: "Writing that down…",
  thinking: "Navi Soul is thinking…",
  speaking: "Answering — the mic reopens after"
};

type Props = {
  value: string;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  effortLabel: string;
  hasMessages: boolean;
  research: boolean;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const [liveTranscript, setLiveTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [touchKeyboard, setTouchKeyboard] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;
  const peakRef = useRef(0);
  const waveformRef = useRef<number[]>([]);

  const commands: Skill[] = value.startsWith("/") && !value.includes("\n") ? suggest(value, 6) : [];
  const showCommands = commands.length > 0 && focused;

  const dictating = listening || transcribing;
  const talking = conversation.active;

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
  }), []);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  const available = providerReady !== false;
  const canSend = (online || offlineCommand) && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = false;
  const hiddenAttachmentCount = Math.max(0, attachmentCount - selectedFiles.length);

  const placeholder = attachmentCount
    ? "Add instructions for these files"
    : hasMessages ? "Write a message…" : "How can I help you today?";

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

  useEffect(() => {
    if (!listening) { setRecordedSeconds(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setRecordedSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [listening]);

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

  function openTools() {
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
        onLevel: (level) => { peakRef.current = Math.max(peakRef.current, level); },
        onSpeaking: setSpeaking,
        onTranscript: setLiveTranscript,
        onError: (message) => setVoiceMessage(message),
        onAutoStop: (reason: AutoStopReason) => {
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
        className={`navi-composer-dock relative z-40 shrink-0 border-t transition-colors duration-150 ${dragActive ? "border-[#0A84FF] bg-[#0A84FF]/5" : "border-[var(--border-subtle)]"}`}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        <div className="mx-auto w-full max-w-app">
          {/* Universal native iOS File Picker mapped to the + button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={COMBINED_ACCEPT}
            className="hidden"
            onChange={(event) => {
              addSelectedFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          {dragActive ? (
            <div className="mb-2 flex min-h-12 items-center justify-center rounded-2xl border border-dashed border-[#0A84FF] bg-elev-2 px-3 text-[0.75rem]/4 font-semibold text-primary">
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
              className="mb-1.5 overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-elev-1 shadow-sm"
            >
              {commands.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onPointerDown={(event) => { event.preventDefault(); completeCommand(skill); }}
                  className="flex min-h-[52px] w-full items-center gap-3 border-b border-[var(--border-subtle)] px-3 text-left last:border-b-0 active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] tracking-[-0.41px] text-primary">{skill.triggers.slash}</span>
                    <span className="block truncate text-[13px] text-tertiary">{skill.description}</span>
                  </span>
                  <span className="shrink-0 rounded-[4px] bg-elev-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tertiary">
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
              className="max-h-[168px] min-h-11 w-full overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[17px] tracking-[-0.41px] text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
            />

            <div className="mt-0.5 flex min-h-11 items-center gap-0.5 px-1 pb-1">
              {listening || talking ? null : (
              <button
                type="button"
                onClick={() => {
                  if (blocked || generating) return;
                  haptic("selection", haptics);
                  fileInputRef.current?.click();
                }}
                disabled={blocked || generating}
                className="composer-action"
                aria-label="Add photos, camera, and files"
              >
                <Plus size={22} strokeWidth={1.5} />
              </button>
              )}

              {listening || talking ? null : (
              <button
                type="button"
                onClick={onOpenEffort}
                className="flex items-center gap-1 px-2 text-[13px] font-medium text-tertiary hover:text-secondary active:opacity-60 transition-colors"
                aria-label={`Effort: ${effortLabel}. Change effort`}
              >
                <span className="truncate">{effortLabel}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
              )}

              {listening || talking ? null : <span className="min-w-0 flex-1" />}

              {talking ? (
                <span
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1 ring-1 transition-colors duration-150 ${conversation.hearing ? "ring-[#0A84FF]" : "ring-transparent"}`}
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
                        className={`w-1.5 rounded-full transition-[height,background-color] duration-100 ${conversation.hearing ? "bg-[#0A84FF]" : "bg-[var(--border-strong)]"}`}
                        style={{ height: `${Math.max(4, Math.min(22, 4 + conversation.level * weight * 26))}px` }}
                      />
                    ))}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#0A84FF]">
                    {conversation.phase === "speaking"
                      ? <Volume2 size={17} />
                      : conversation.phase === "listening"
                        ? <AudioLines size={17} />
                        : <LoaderCircle size={17} className="animate-spin" />}
                  </span>
                </span>
              ) : listening ? (
                <span
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1 ring-1 transition-colors duration-150 ${speaking ? "ring-[#0A84FF]" : "ring-transparent"}`}
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
                      const offset = index - (WAVEFORM_BAR_COUNT - waveform.length);
                      const level = offset >= 0 ? waveform[offset] : 0;
                      const height = Math.max(3, Math.round(3 + level * 19));
                      return (
                        <span
                          key={index}
                          className={`w-[3px] shrink-0 rounded-full transition-[height,background-color] duration-100 ${level > 0.02 ? "bg-[#0A84FF]" : "bg-[var(--border-strong)]"}`}
                          style={{ height: `${height}px` }}
                        />
                      );
                    })}
                  </span>
                  <span
                    className="shrink-0 tabular-nums text-[13px] font-semibold text-secondary"
                    aria-label={`Recording, ${recordedSeconds} seconds`}
                  >
                    {Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white active:bg-opacity-80"
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
                <Mic size={20} strokeWidth={1.5} />
              </button>
              )}
              {listening || talking ? null : (
              <button
                type="button"
                onClick={conversation.toggle}
                disabled={blocked || generating || transcribing || !online}
                className="composer-action"
                aria-label="Start a voice conversation"
                aria-pressed={false}
              >
                <AudioLines size={20} strokeWidth={1.5} />
              </button>
              )}
              {value.trim() || attachmentCount || generating ? (
                <button
                  type={generating ? "button" : "submit"}
                  onClick={generating ? onStop : undefined}
                  disabled={!generating && !canSend}
                  className={`flex h-[34px] w-[34px] ml-1 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-[#0A84FF] text-white shadow-sm active:scale-95 active:bg-opacity-80" : "bg-elev-3 text-disabled"}`}
                  aria-label={generating ? "Stop response" : "Send message"}
                >
                  {generating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} strokeWidth={2} />}
                </button>
              ) : null}
            </div>
          </form>

          <div className="flex items-center justify-center px-3 text-center pb-[max(0px,env(safe-area-inset-bottom))] mb-2" role="status" aria-live="polite">
            {footer ? (
              <span className={`block max-h-8 overflow-hidden pt-1 text-[11px] font-medium ${footerTone}`}>{footer}</span>
            ) : hasMessages ? (
              <span className="block pt-1 text-[11px] font-medium text-tertiary">Navi Soul is AI and can make mistakes. Double-check important answers.</span>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
