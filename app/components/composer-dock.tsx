"use client";

import {
  AudioLines,
  ArrowUp,
  ChevronDown,
  Globe,
  SquareTerminal,
  FileText,
  LoaderCircle,
  Mic,
  Plus,
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
  modelLabel: string;
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
  onOpenModels: () => void;
  conversation: VoiceConversation;
  onToggleResearch: () => void;
  onOpenTools: () => void;
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
  modelLabel,
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
  onOpenModels,
  conversation,
  onToggleResearch,
  onOpenTools
}: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<RecordingSession | null>(null);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const dictationEpochRef = useRef(0);
  const dictationBaseRef = useRef("");

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

  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  /* One line under the composer explaining why something did not do what it
     looked like it would. It carried recording failures until the dictation
     path was removed, after which nothing set it — read in two places and
     written in none. Renamed rather than deleted, because the Research switch
     needs exactly this. */
  const [notice, setNotice] = useState<string | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  /* Whether a search provider is configured on this deployment. The composer
     has been fetching this in the same payload all along and reading only the
     model providers out of it. */
  const [searchConfigured, setSearchConfigured] = useState(true);
  const [touchKeyboard, setTouchKeyboard] = useState(false);
  const [dictationStarting, setDictationStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;

  const commands: Skill[] = value.startsWith("/") && !value.includes("\n") ? suggest(value, 6) : [];
  const showCommands = commands.length > 0 && focused;

  const talking = conversation.active;
  const dictating = dictationStarting || listening || transcribing;
  const compactModelLabel = modelLabel === "Automatic"
    ? "Auto"
    : modelLabel === "Staged council"
      ? "Deep"
      : modelLabel === "Parallel council"
        ? "Team"
        : modelLabel;

  const previewValue = talking
    ? conversation.transcript
    : dictating && liveTranscript
      ? `${dictationBaseRef.current}${dictationBaseRef.current.trim() ? " " : ""}${liveTranscript}`
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
    /* Absent means "this deployment did not say", which is not the same as
       "no". Only an explicit `false` dims the switch. */
    setSearchConfigured(data.search?.configured !== false);
  }), []);

  useEffect(() => {
    if (!talking || (!startingRef.current && !finishingRef.current && !recorderRef.current)) return;
    dictationEpochRef.current += 1;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    startingRef.current = false;
    finishingRef.current = false;
    setDictationStarting(false);
    setListening(false);
    setTranscribing(false);
    setSpeaking(false);
    setLiveTranscript("");
  }, [talking]);

  useEffect(() => () => {
    dictationEpochRef.current += 1;
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, []);

  const available = providerReady !== false;
  const canSend = (online || offlineCommand) && !generating && !dictating && Boolean(value.trim() || attachmentCount);
  const blocked = false;
  const hiddenAttachmentCount = Math.max(0, attachmentCount - selectedFiles.length);

  const placeholder = attachmentCount
    ? "Add instructions for these files"
    : hasMessages ? "Write a message…" : "";

  const spokenBy = conversation.voice && conversation.phase === "speaking"
    ? conversation.voice.engine === "premium"
      ? "Answering in the premium voice"
      : conversation.voice.engine === "device"
        ? `Answering in this device's voice — ${conversation.voice.why}`
        : `No voice available — ${conversation.voice.why}`
    : null;

  const footer = conversation.error
    ?? (talking ? `${spokenBy ?? CONVERSATION_PLACEHOLDER[conversation.phase]} · tap the waveform to end` : null)
    ?? (dictationStarting
      ? "Opening the microphone…"
      : listening
        ? `${speaking ? "Listening" : "Ready"} · tap the mic to add this transcript`
        : transcribing
          ? "Finishing the transcript…"
          : null)
    ?? notice
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
    : talking || dictating
      ? "text-accent"
      : !online || !available || notice || attachmentMessage ? "text-warning" : "text-tertiary";

  async function startDictation() {
    if (startingRef.current || finishingRef.current || recorderRef.current || talking || generating || !online) return;

    startingRef.current = true;
    const epoch = dictationEpochRef.current + 1;
    dictationEpochRef.current = epoch;
    dictationBaseRef.current = valueRef.current;
    setNotice(null);
    setLiveTranscript("");
    setSpeaking(false);
    setDictationStarting(true);
    haptic("selection", haptics);

    try {
      const session = await startRecording({
        language: voiceLanguage,
        handsFree: false,
        onSpeaking: (next) => {
          if (dictationEpochRef.current === epoch) setSpeaking(next);
        },
        onTranscript: (text) => {
          if (dictationEpochRef.current === epoch) setLiveTranscript(text);
        },
        onError: (message) => {
          if (dictationEpochRef.current === epoch) setNotice(message);
        },
        onAutoStop: (reason: AutoStopReason) => {
          if (dictationEpochRef.current !== epoch) return;
          if (reason === "too-long") {
            setNotice(`Recording stopped at ${Math.round(MAX_RECORDING_SECONDS / 60)} minutes. Keeping what you said.`);
          }
          window.setTimeout(() => void finishDictation(), 0);
        }
      });

      if (dictationEpochRef.current !== epoch || conversation.active) {
        session.cancel();
        return;
      }
      recorderRef.current = session;
      setListening(true);
    } catch (error) {
      if (dictationEpochRef.current === epoch) {
        setNotice(error instanceof Error ? error.message : "Recording could not start.");
      }
    } finally {
      if (dictationEpochRef.current === epoch) {
        setDictationStarting(false);
        startingRef.current = false;
      }
    }
  }

  async function finishDictation() {
    if (finishingRef.current) return;
    const session = recorderRef.current;
    recorderRef.current = null;
    if (!session) return;

    const epoch = dictationEpochRef.current;
    finishingRef.current = true;
    setListening(false);
    setSpeaking(false);
    setTranscribing(true);
    haptic("selection", haptics);

    try {
      const text = (await session.stop()).trim();
      if (dictationEpochRef.current !== epoch) return;
      if (text) {
        const current = valueRef.current;
        onChange(`${current}${current.trim() ? " " : ""}${text}`);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        setNotice("Nothing was picked up.");
      }
    } catch (error) {
      if (dictationEpochRef.current === epoch) {
        setNotice(error instanceof Error ? error.message : "That recording could not be transcribed.");
      }
    } finally {
      finishingRef.current = false;
      if (dictationEpochRef.current === epoch) {
        setTranscribing(false);
        setLiveTranscript("");
      }
    }
  }

  function toggleDictation() {
    if (dictationStarting || transcribing) return;
    if (listening) void finishDictation();
    else void startDictation();
  }

  function toggleConversation() {
    if (startingRef.current || finishingRef.current || recorderRef.current || dictating) return;
    conversation.toggle();
  }

  function send() {
    if ((!value.trim() && attachmentCount === 0) || generating || dictating) return;
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

  return (
    <>
      <div
        ref={dockRef}
        data-home={hasMessages ? "false" : "true"}
        className={`navi-composer-dock relative z-40 shrink-0 border-t transition-colors duration-150 ${dragActive ? "border-accent bg-accent/5" : "border-[var(--border-subtle)]"}`}
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
            data-home={hasMessages ? "false" : "true"}
            data-talking={talking ? "true" : "false"}
            data-dictating={dictating ? "true" : "false"}
            data-has-send={value.trim() || attachmentCount || generating ? "true" : "false"}
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
              readOnly={talking || dictating}
              placeholder={talking
                ? CONVERSATION_PLACEHOLDER[conversation.phase]
                : dictationStarting
                  ? "Opening microphone…"
                  : listening
                    ? "Listening — speak naturally"
                    : transcribing
                      ? "Finishing transcript…"
                      : placeholder}
              aria-label="Chat with Navi Soul"
              data-navi-composer=""
              className="max-h-[168px] min-h-11 w-full overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[17px] tracking-[-0.41px] text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
            />

            <div className="navi-composer-actions mt-0.5 flex min-h-11 items-center gap-0.5 px-1 pb-1">
              {talking ? null : (
              <button
                type="button"
                onClick={() => {
                  if (blocked || generating || dictating) return;
                  haptic("selection", haptics);
                  fileInputRef.current?.click();
                }}
                disabled={blocked || generating || dictating}
                className="home-attachment-action composer-action"
                aria-label="Add photos, camera, and files"
              >
                <Plus size={22} strokeWidth={1.5} />
              </button>
              )}

              {talking ? null : (
              /* Web research, put back.
                 The redesign left `research` and `onToggleResearch` arriving as
                 props with nothing calling them, so searching the web became
                 unreachable from anywhere in the app — while the prompt still
                 offered it and the router still weighed it. Code mode did not
                 survive it either — the note that used to stand here said it
                 had moved to the sidebar, and it had not: `onToggleCode`
                 arrived beside `onToggleResearch` and was called by nothing,
                 from either place.

                 A switch rather than a button, because it has an on state a
                 screen reader has to be able to read. */
              <button
                type="button"
                role="switch"
                aria-checked={searchConfigured && research}
                onClick={() => {
                  haptic("selection", haptics);
                  /* The switch used to flip regardless, and with no search
                     provider configured that turned a flag nothing could act
                     on: `web_search` is only registered when a key exists, so
                     the globe lit up and the next answer was identical. A
                     control that reports success and does nothing is worse
                     than one that is plainly unavailable. */
                  if (!searchConfigured) {
                    setNotice("Web search needs a provider key — no search runs without one. Links you paste are still read.");
                    return;
                  }
                  setNotice(null);
                  onToggleResearch();
                }}
                disabled={blocked || generating || dictating}
                className={`composer-secondary-action composer-action ${!searchConfigured ? "text-disabled" : research ? "text-accent" : ""}`}
                aria-label={!searchConfigured
                  ? "Research unavailable — no search provider is configured"
                  : research ? "Research is on. Turn off web search" : "Research is off. Turn on web search"}
              >
                <Globe size={20} strokeWidth={1.5} />
              </button>
              )}

              {talking ? null : (
              /* Code mode, put back for the same reason and by the same
                 evidence. `toggleCodeMode` in the shell had exactly one caller
                 — this prop — and this prop had none, so a whole routing lane,
                 its preset and its prompt sat behind a control that did not
                 exist. Nothing in the app could turn it on.

                 Beside Research rather than in a menu: both answer the same
                 question about a turn, which is what this reply is allowed to
                 reach for. */
              <button
                type="button"
                role="switch"
                aria-checked={codeMode}
                onClick={() => { haptic("selection", haptics); onToggleCode(); }}
                disabled={blocked || generating || dictating}
                className={`composer-secondary-action composer-action ${codeMode ? "text-accent" : ""}`}
                aria-label={codeMode ? "Code mode is on. Switch back to chat" : "Code mode is off. Turn on code mode"}
              >
                <SquareTerminal size={20} strokeWidth={1.5} />
              </button>
              )}

              {talking ? null : (
              <button
                type="button"
                onClick={onOpenModels}
                disabled={dictating}
                className="composer-model-action flex min-h-9 min-w-0 max-w-[180px] items-center gap-1 rounded-full px-2 text-[13px] font-medium text-tertiary hover:text-secondary active:bg-elev-2 disabled:opacity-50"
                aria-label={`Model: ${modelLabel}. Effort: ${effortLabel}. Change model or effort`}
              >
                <span className="composer-model-label truncate font-semibold text-primary">{compactModelLabel}</span>
                <span className="composer-effort-label shrink-0">{effortLabel}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
              )}

              {talking ? null : <span className="composer-row-spacer min-w-0 flex-1" />}

              {talking ? (
                <span
                  className={`composer-voice-status flex min-w-0 flex-1 items-center gap-2 rounded-full bg-elev-2 px-2 py-1 ring-1 transition-colors duration-150 ${conversation.hearing ? "ring-accent" : "ring-transparent"}`}
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
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent">
                    {conversation.phase === "speaking"
                      ? <Volume2 size={17} />
                      : conversation.phase === "listening"
                        ? <AudioLines size={17} />
                        : <LoaderCircle size={17} className="animate-spin" />}
                  </span>
                </span>
              ) : null}
              {talking ? null : (
                <button
                  type="button"
                  onClick={toggleDictation}
                  disabled={blocked || generating || !online || dictationStarting || transcribing}
                  className={`home-mic composer-dictation-action composer-action ${listening ? "text-accent" : ""}`}
                  aria-label={dictationStarting
                    ? "Opening the microphone"
                    : transcribing
                      ? "Transcribing the recording"
                      : listening
                        ? "Stop recording and add transcript"
                        : "Record a message"}
                  aria-pressed={listening}
                >
                  {dictationStarting || transcribing
                    ? <LoaderCircle size={19} className="animate-spin" />
                    : listening
                      ? <Square size={13} fill="currentColor" />
                      : <Mic size={20} strokeWidth={1.6} />}
                </button>
              )}
              {talking ? null : (
              <button
                type="button"
                onClick={toggleConversation}
                disabled={blocked || generating || !online || dictating}
                className="composer-voice-action composer-action"
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
                  className={`composer-send-action flex h-[34px] w-[34px] ml-1 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-accent text-white shadow-sm active:scale-95 active:bg-opacity-80" : "bg-elev-3 text-disabled"}`}
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
