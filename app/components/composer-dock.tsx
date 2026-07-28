"use client";

import {
  AudioLines,
  ArrowUp,
  Camera,
  ChevronDown,
  FileText,
  FolderPlus,
  Globe2,
  Image as ImageIcon,
  Mic,
  PlugZap,
  Plus,
  Puzzle,
  Search,
  Square,
  X
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { haptic } from "@/lib/ui/haptics";

const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 6_000_000;
const MAX_REQUEST_BYTES = 10_000_000;

const DOCUMENT_ACCEPT = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf"
].join(",");

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},${DOCUMENT_ACCEPT}`;

type Props = {
  value: string;
  ready: boolean;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  modelLabel: string;
  research: boolean;
  haptics: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onOpenModels: () => void;
  onOpenVoice: () => void;
  onToggleResearch: () => void;
  onOpenTools: () => void;
  onOpenProjects: () => void;
  onOpenConnectors: () => void;
};

type ProviderStatus = {
  providers?: {
    gemini?: boolean;
    groq?: boolean;
    huggingface?: boolean;
  };
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
        <span className="block truncate text-[12px]/4 font-semibold text-primary">{file.name}</span>
        <span className="block text-[10px]/4 font-medium text-tertiary">{formatBytes(file.size)}</span>
      </span>
    </div>
  );
}

export function ComposerDock({
  value,
  ready,
  generating,
  online,
  attachmentCount,
  statusText,
  modelLabel,
  research,
  haptics,
  onChange,
  onSend,
  onStop,
  onFiles,
  onOpenModels,
  onOpenVoice,
  onToggleResearch,
  onOpenTools,
  onOpenProjects,
  onOpenConnectors
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const sourceDialogRef = useRef<HTMLElement>(null);
  const sourceCloseRef = useRef<HTMLButtonElement>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);

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
    void fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: ProviderStatus) => {
        if (cancelled) return;
        const providers = data.providers;
        setProviderReady(Boolean(providers?.gemini || providers?.groq || providers?.huggingface));
      })
      .catch(() => {
        if (!cancelled) setProviderReady(null);
      });
    return () => {
      cancelled = true;
      recognitionRef.current?.abort?.();
    };
  }, []);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sourceCloseRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSourceMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sourceDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [sourceMenuOpen]);

  const available = providerReady !== false;
  const canSend = ready && online && available && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = !ready || !online || !available;
  const hiddenAttachmentCount = Math.max(0, attachmentCount - selectedFiles.length);

  const placeholder = !ready
    ? "Loading your workspace"
    : !online
    ? "Navi is offline"
    : !available
      ? "AI provider setup required"
      : attachmentCount
        ? "Add instructions for these files"
        : "Message Navi";

  const footer = voiceMessage
    ?? attachmentMessage
    ?? (!ready
      ? "Restoring your local workspace…"
      : !online
      ? "Offline · your draft is saved locally"
      : !available
        ? "Add a Gemini, Groq, or Hugging Face key in Vercel to enable Navi"
        : attachmentCount
          ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready · ${statusText}`
          : statusText);

  const footerTone = blocked || voiceMessage || attachmentMessage ? "text-warning" : "text-tertiary";

  const totalSelectedBytes = useMemo(
    () => selectedFiles.reduce((total, file) => total + file.size, 0),
    [selectedFiles]
  );

  function send() {
    if ((!value.trim() && attachmentCount === 0) || !ready || sending || generating || !online || !available) return;
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
    const invalid = incoming.find((file) => file.size > MAX_FILE_BYTES);

    if (invalid) {
      setAttachmentMessage(`${invalid.name} is larger than 6 MB.`);
      haptic("warning", haptics);
      return;
    }

    if (nextCount > MAX_ATTACHMENTS) {
      setAttachmentMessage(`You can attach up to ${MAX_ATTACHMENTS} items at once.`);
      haptic("warning", haptics);
      return;
    }

    const incomingBytes = incoming.reduce((total, file) => total + file.size, 0);
    if (totalSelectedBytes + incomingBytes > MAX_REQUEST_BYTES) {
      setAttachmentMessage("Attachments exceed the 10 MB request limit.");
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

  function openProjects() {
    setSourceMenuOpen(false);
    haptic("selection", haptics);
    onOpenProjects();
  }

  function openConnectors() {
    setSourceMenuOpen(false);
    haptic("selection", haptics);
    onOpenConnectors();
  }

  function enableWebSearch() {
    setSourceMenuOpen(false);
    if (!research) onToggleResearch();
    haptic("selection", haptics);
  }

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceMessage("Voice dictation is not supported in this browser.");
      haptic("warning", haptics);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage("Listening…");
      haptic("selection", haptics);
    };
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      if (transcript.trim()) onChange(`${value}${value.trim() ? " " : ""}${transcript.trim()}`);
    };
    recognition.onerror = () => {
      setListening(false);
      setVoiceMessage("Voice input stopped. Try again.");
      haptic("error", haptics);
    };
    recognition.onend = () => {
      setListening(false);
      setVoiceMessage(null);
      textareaRef.current?.focus();
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <>
      <div
        className={`navi-composer-dock relative z-40 shrink-0 border-t transition-colors duration-150 ${dragActive ? "border-accent bg-[var(--selection-bg)]" : "border-[var(--border-subtle)]"}`}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        <div className="mx-auto w-full max-w-app">
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
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              addSelectedFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          {dragActive ? (
            <div className="mb-2 flex min-h-12 items-center justify-center rounded-2xl border border-dashed border-accent bg-elev-2 px-3 text-[12px]/4 font-semibold text-primary">
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
                  className="flex min-h-[56px] min-w-[132px] items-center justify-center rounded-[16px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[12px]/4 font-semibold text-secondary active:bg-elev-3"
                >
                  +{hiddenAttachmentCount} more
                </button>
              ) : null}
              <button
                type="button"
                onClick={openTools}
                className="min-h-[56px] shrink-0 rounded-[16px] px-3 text-[12px]/4 font-semibold text-secondary active:bg-elev-2"
                aria-label="Manage or clear attachments"
              >
                Manage
              </button>
            </div>
          ) : null}

          <form
            onSubmit={submit}
            data-focused={focused ? "true" : "false"}
            className={`navi-composer flex flex-col p-2 ${sending ? "scale-[0.985]" : "scale-100"}`}
          >
            <textarea
              ref={textareaRef}
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
              enterKeyHint="send"
              inputMode="text"
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              disabled={blocked}
              placeholder={placeholder}
              aria-label="Message Navi"
              className="max-h-[168px] min-h-12 w-full overflow-y-auto bg-transparent px-2.5 pb-1 pt-2 text-[16px]/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
            />

            <div className="relative mt-1 flex min-h-11 items-center gap-1">
              <div className="flex items-center gap-1">
                <button
                  ref={sourceTriggerRef}
                  type="button"
                  onClick={openSourceMenu}
                  disabled={blocked || generating}
                  className="composer-action !h-10 !w-10"
                  aria-label="Open add menu for files, photos, projects, connectors, plugins, and web search"
                  aria-expanded={sourceMenuOpen}
                  aria-controls="navi-add-menu"
                >
                  <Plus size={21} />
                </button>

                <button
                  type="button"
                  onClick={onToggleResearch}
                  disabled={blocked || generating}
                  className={`composer-action !h-10 !w-10 ${research ? "bg-[var(--selection-bg)] text-accent" : ""}`}
                  aria-label={research ? "Turn off web research" : "Turn on web research"}
                  aria-pressed={research}
                >
                  <Search size={17} />
                </button>
              </div>

              <button
                type="button"
                onClick={onOpenModels}
                disabled={blocked || generating}
                className="absolute left-1/2 z-10 flex min-h-10 max-w-[132px] -translate-x-1/2 items-center gap-1 rounded-full px-2.5 text-[12px]/4 font-semibold text-primary active:bg-elev-3"
                aria-label={`Current Navi model: ${modelLabel}. Change model or response profile`}
              >
                <span className="truncate">{modelLabel}</span>
                <ChevronDown size={14} className="shrink-0 text-tertiary" />
              </button>

              <span className="min-w-0 flex-1" />

              {!value.trim() && !attachmentCount && !generating ? (
                <>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={blocked}
                    className={`composer-action !h-10 !w-10 ${listening ? "bg-accent text-white" : ""}`}
                    aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
                    aria-pressed={listening}
                  >
                    <Mic size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenVoice}
                    disabled={blocked}
                    className="composer-action !h-10 !w-10"
                    aria-label="Use voice mode"
                  >
                    <AudioLines size={19} />
                  </button>
                </>
              ) : null}

              <button
                type={generating ? "button" : "submit"}
                onClick={generating ? onStop : undefined}
                disabled={!generating && !canSend}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-accent text-white shadow-sm active:scale-95 active:bg-accent-pressed" : "bg-elev-3 text-disabled"}`}
                aria-label={generating ? "Stop response" : "Send message"}
              >
                {generating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={19} strokeWidth={2.4} />}
              </button>
            </div>
          </form>

          <div className={`flex min-h-6 items-center justify-center px-3 pt-1 text-center text-[10px]/4 font-semibold ${footerTone}`} role="status" aria-live="polite">
            {footer}
          </div>
        </div>
      </div>

      {sourceMenuOpen ? (
        <div className="fixed inset-0 z-[85]">
          <button
            type="button"
            aria-label="Close attachment menu"
            onClick={() => setSourceMenuOpen(false)}
            className="absolute inset-0 bg-overlay backdrop-blur-[3px]"
          />
          <section
            ref={sourceDialogRef}
            id="navi-add-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Add to message"
            className="context-enter absolute inset-x-0 bottom-0 mx-auto w-full max-w-app rounded-t-sheet border border-b-0 border-[var(--border-subtle)] bg-elev-1 px-gutter pb-[calc(18px+var(--safe-bottom))] pt-3 shadow-sheet"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-elev-3" />
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[17px]/6 font-semibold text-primary">Add to message</div>
                <div className="text-[12px]/4 font-medium text-tertiary">Up to six items, 10 MB total</div>
              </div>
              <button
                ref={sourceCloseRef}
                type="button"
                onClick={() => setSourceMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2" aria-label="Add menu options">
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                className="flex min-h-[68px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <ImageIcon size={22} className="text-accent" />
                <span>Add files/photos</span>
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex min-h-[68px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <Camera size={22} className="text-accent" />
                <span>Take a screenshot/camera</span>
              </button>
              <button
                type="button"
                onClick={openProjects}
                className="flex min-h-[58px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <FolderPlus size={19} className="text-accent" />
                <span>Add to project</span>
              </button>
              <button
                type="button"
                onClick={openTools}
                className="flex min-h-[58px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <Puzzle size={19} className="text-accent" />
                <span>Skills</span>
              </button>
              <button
                type="button"
                onClick={openConnectors}
                className="flex min-h-[58px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <PlugZap size={19} className="text-accent" />
                <span>Add connector</span>
              </button>
              <button
                type="button"
                onClick={openConnectors}
                className="flex min-h-[58px] items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left text-[13px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <Puzzle size={19} className="text-accent" />
                <span>Plugins</span>
              </button>
              <button
                type="button"
                onClick={enableWebSearch}
                className={`col-span-2 flex min-h-[54px] items-center gap-3 rounded-card border border-[var(--border-subtle)] px-3 text-left text-[13px]/4 font-semibold active:bg-elev-3 ${research ? "bg-[var(--selection-bg)] text-accent" : "bg-elev-2 text-primary"}`}
              >
                <Globe2 size={19} className="text-accent" />
                <span className="min-w-0 flex-1">Web search</span>
                <span className="text-[11px]/4 font-medium text-tertiary">{research ? "On" : "Off"}</span>
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-3 py-2 text-center text-[11px]/4 font-medium text-tertiary">
              Paste screenshots or drag files onto the composer. Skills and plugins open available Navi controls; no capability is implied until it is configured.
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
