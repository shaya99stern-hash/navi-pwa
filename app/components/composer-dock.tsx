"use client";

import { ArrowUp, Mic, Paperclip, SlidersHorizontal, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/ui/haptics";

type Props = {
  value: string;
  generating: boolean;
  online: boolean;
  attachmentCount: number;
  statusText: string;
  haptics: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFiles: (files: FileList | null) => void;
  onOpenTools: () => void;
};

type ProviderStatus = {
  providers?: {
    gemini?: boolean;
    groq?: boolean;
    huggingface?: boolean;
  };
};

export function ComposerDock({
  value,
  generating,
  online,
  attachmentCount,
  statusText,
  haptics,
  onChange,
  onSend,
  onStop,
  onFiles,
  onOpenTools
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(160, Math.max(24, textarea.scrollHeight))}px`;
  }, [value]);

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

  const available = providerReady !== false;

  function send() {
    if ((!value.trim() && attachmentCount === 0) || generating || !online || !available) return;
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
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

  const canSend = online && available && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = !online || !available;
  const placeholder = !online
    ? "Navi is offline"
    : !available
      ? "AI provider setup required"
      : "Message Navi";
  const footer = voiceMessage
    ?? (!online
      ? "Offline · your draft is saved locally"
      : !available
        ? "Add a Gemini, Groq, or Hugging Face key in Vercel to enable Navi"
        : attachmentCount
          ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready · ${statusText}`
          : statusText);

  return (
    <div className="composer-dock shrink-0 px-4 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json,application/pdf"
          className="hidden"
          onChange={(event) => {
            onFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <form onSubmit={submit} className={`composer-surface rounded-[26px] border border-[var(--border-strong)] bg-elev-1 p-2 shadow-composer transition-transform duration-[90ms] ${sending ? "scale-[0.985]" : "scale-100"}`}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={keyDown}
            rows={1}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            disabled={blocked}
            placeholder={placeholder}
            aria-label="Message Navi"
            className="max-h-40 min-h-10 w-full overflow-y-auto bg-transparent px-2 py-2 text-[16px]/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={blocked || generating}
                className="composer-action"
                aria-label="Add files or images"
              >
                <Paperclip size={18} />
              </button>
              <button type="button" onClick={onOpenTools} className="composer-action" aria-label="Open tools and settings">
                <SlidersHorizontal size={18} />
              </button>
              <button
                type="button"
                onClick={toggleVoice}
                disabled={blocked || generating}
                className={`composer-action ${listening ? "bg-accent text-white" : ""}`}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
              >
                <Mic size={18} />
              </button>
            </div>
            <button
              type={generating ? "button" : "submit"}
              onClick={generating ? onStop : undefined}
              disabled={!generating && !canSend}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-[120ms] ${generating || canSend ? "bg-accent text-white shadow-sm active:scale-95 active:bg-accent-pressed" : "bg-elev-3 text-disabled"}`}
              aria-label={generating ? "Stop response" : "Send message"}
            >
              {generating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} strokeWidth={2.4} />}
            </button>
          </div>
        </form>
        <div className={`flex min-h-7 items-center justify-center px-3 text-center text-[11px]/[14px] font-semibold ${blocked || voiceMessage ? "text-warning" : "text-tertiary"}`} role="status" aria-live="polite">
          {footer}
        </div>
      </div>
    </div>
  );
}
