"use client";

import {
  AudioLines,
  ArrowUp,
  Camera,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
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
import { haptic } from "@/lib/ui/haptics";
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

type Props = {
  value: string;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  modelLabel: string;
  research: boolean;
  /** The draft is a slash command, which runs on-device and needs no network. */
  offlineCommand: boolean;
  haptics: boolean;
  /** Lets the shell focus the composer synchronously from a tap handler. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onOpenModels: () => void;
  onOpenVoice: () => void;
  onToggleResearch: () => void;
  onOpenTools: () => void;
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
  generating,
  online,
  attachmentCount,
  statusText,
  modelLabel,
  research,
  offlineCommand,
  haptics,
  inputRef,
  onChange,
  onSend,
  onStop,
  onFiles,
  onOpenModels,
  onOpenVoice,
  onToggleResearch,
  onOpenTools
}: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [touchKeyboard, setTouchKeyboard] = useState(false);
  const sourceSheet = useSheetDrag({ open: sourceMenuOpen, onDismiss: () => setSourceMenuOpen(false), haptics });

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
          setProviderReady(Boolean(providers?.gemini || providers?.groq || providers?.huggingface));
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
      recognitionRef.current?.abort?.();
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

  const placeholder = attachmentCount ? "Add instructions for these files" : "Chat with Navi";

  /* Idle status is deliberately empty: the thinking indicator in the thread
     already reports progress while generating. */
  const footer = voiceMessage
    ?? attachmentMessage
    ?? (!online && !offlineCommand
      ? "Offline · your draft is saved locally"
      : !available
        ? "Add a Gemini, Groq, or Hugging Face key in Vercel to enable replies"
        : attachmentCount
          ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready`
          : null);

  const footerTone = !online || !available || voiceMessage || attachmentMessage ? "text-warning" : "text-tertiary";

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
              aria-label="Chat with Navi"
              className="max-h-[168px] min-h-11 w-full overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[16px]/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
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
                onClick={onOpenModels}
                className="flex min-h-9 min-w-0 max-w-[130px] items-center gap-1 rounded-full px-2 text-[13px]/4 font-medium text-secondary active:bg-elev-2"
                aria-label={`Current model: ${modelLabel}. Change model`}
              >
                <span className="truncate">{modelLabel}</span>
                <ChevronDown size={13} className="shrink-0 text-tertiary" />
              </button>

              <span className="min-w-0 flex-1" />

              {!value.trim() && !attachmentCount && !generating ? (
                <>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={blocked}
                    className={`composer-action ${listening ? "!bg-accent !text-[var(--accent-on-primary)]" : ""}`}
                    aria-label={listening ? "Stop dictation" : "Dictate"}
                    aria-pressed={listening}
                  >
                    <Mic size={19} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenVoice}
                    disabled={blocked}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[var(--accent-on-primary)] shadow-sm transition-transform duration-[120ms] active:scale-95 active:bg-accent-pressed"
                    aria-label="Use voice mode"
                  >
                    <AudioLines size={18} strokeWidth={2} />
                  </button>
                </>
              ) : (
                <button
                  type={generating ? "button" : "submit"}
                  onClick={generating ? onStop : undefined}
                  disabled={!generating && !canSend}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-accent text-[var(--accent-on-primary)] shadow-sm active:scale-95 active:bg-accent-pressed" : "bg-elev-3 text-disabled"}`}
                  aria-label={generating ? "Stop response" : "Send message"}
                >
                  {generating ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
                </button>
              )}
            </div>
          </form>

          {/* Only surface a line here when it is actionable. A permanent status
              caption under the composer is noise the native app never shows. */}
          <div className="flex items-center justify-center px-3 text-center" role="status" aria-live="polite">
            {footer ? (
              <span className={`block pt-1 text-[11px]/4 font-medium ${footerTone}`}>{footer}</span>
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
                <div className="text-[17px]/6 font-semibold text-primary">Add to message</div>
                <div className="text-[12px]/4 font-medium text-tertiary">Up to six items · photos are resized to fit</div>
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

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-2 text-[12px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <ImageIcon size={22} className="text-accent" />
                Photos
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-2 text-[12px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <Camera size={22} className="text-accent" />
                Camera
              </button>
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-2 text-[12px]/4 font-semibold text-primary active:bg-elev-3"
              >
                <Paperclip size={22} className="text-accent" />
                Files
              </button>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={research}
              onClick={() => { haptic("selection", haptics); onToggleResearch(); }}
              className="mt-3 flex min-h-[56px] w-full items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-elev-2 px-3 text-left active:bg-elev-3"
            >
              <Search size={20} className={research ? "text-accent" : "text-secondary"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]/[22px] font-semibold text-primary">Search the web</span>
                <span className="block text-[12px]/4 font-medium text-tertiary">Used only when the active route supports it</span>
              </span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-[100ms] ${research ? "bg-accent" : "bg-elev-3"}`} aria-hidden="true">
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-[140ms] ${research ? "translate-x-6" : "translate-x-1"}`} />
              </span>
            </button>

            <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-3 py-2 text-center text-[11px]/4 font-medium text-tertiary">
              You can also paste screenshots or drag files directly onto the composer.
            </div>

            <button
              type="button"
              onClick={openTools}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[13px]/5 font-semibold text-secondary active:bg-elev-2"
            >
              <SlidersHorizontal size={17} />
              Configure web, code, artifacts, or clear attachments
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
