"use client";

import { ArrowUp, Square } from "lucide-react";
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
};

type ProviderStatus = {
  providers?: {
    gemini?: boolean;
    groq?: boolean;
    huggingface?: boolean;
  };
};

export function ComposerDock({ value, generating, online, attachmentCount, statusText, haptics, onChange, onSend, onStop }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
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

  const canSend = online && available && !generating && Boolean(value.trim() || attachmentCount);
  const blocked = !online || !available;
  const placeholder = !online
    ? "Navi is offline"
    : !available
      ? "AI provider setup required"
      : "Message Navi";
  const footer = !online
    ? "Offline · saved drafts will not send automatically"
    : !available
      ? "Add a Gemini, Groq, or Hugging Face key in Vercel to enable Navi"
      : attachmentCount
        ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready · ${statusText}`
        : statusText;

  return (
    <div className="composer-dock shrink-0 px-4 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <form onSubmit={submit} className={`flex min-h-[52px] items-end gap-2 rounded-[24px] border border-[var(--border-strong)] bg-elev-1 px-2 py-2 pl-4 shadow-composer transition-transform duration-[90ms] ${sending ? "scale-[0.98]" : "scale-100"}`}>
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
            className="max-h-40 min-h-9 min-w-0 flex-1 overflow-y-auto bg-transparent py-1.5 text-base/6 font-normal text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
          />
          <button
            type={generating ? "button" : "submit"}
            onClick={generating ? onStop : undefined}
            disabled={!generating && !canSend}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-[100ms] ${generating || canSend ? "bg-accent text-white active:bg-accent-pressed" : "bg-elev-3 text-disabled"}`}
            aria-label={generating ? "Stop response" : "Send message"}
          >
            {generating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} strokeWidth={2.4} />}
          </button>
        </form>
        <div className={`flex min-h-7 items-center justify-center px-3 text-center text-[11px]/[14px] font-semibold ${blocked ? "text-warning" : "text-tertiary"}`}>
          {footer}
        </div>
      </div>
    </div>
  );
}
