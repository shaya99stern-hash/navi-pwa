"use client";

import { Check, Keyboard, Mic, Send, Square, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "@/lib/ui/haptics";

const LANGUAGE_KEY = "navi.voice.language.v1";
const LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "he-IL", label: "Hebrew" },
  { id: "es-ES", label: "Spanish" },
  { id: "fr-FR", label: "French" }
] as const;

type Props = {
  open: boolean;
  busy: boolean;
  online: boolean;
  haptics: boolean;
  onClose: () => void;
  onUseTranscript: (text: string) => void;
  onSendTranscript: (text: string, speakReply: boolean) => void;
};

export function VoiceModeSheet({
  open,
  busy,
  online,
  haptics,
  onClose,
  onUseTranscript,
  onSendTranscript
}: Props) {
  const recognitionRef = useRef<any>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [language, setLanguage] = useState("en-US");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [speakReply, setSpeakReply] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const combined = useMemo(
    () => [transcript.trim(), interim.trim()].filter(Boolean).join(" ").trim(),
    [interim, transcript]
  );

  useEffect(() => {
    if (!open) return;
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    setSupported(Boolean(SpeechRecognition));
    setLanguage(localStorage.getItem(LANGUAGE_KEY) || navigator.language || "en-US");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function persistLanguage(next: string) {
    setLanguage(next);
    localStorage.setItem(LANGUAGE_KEY, next);
    haptic("selection", haptics);
  }

  function start() {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setError("Live speech recognition is not available in this browser.");
      haptic("warning", haptics);
      return;
    }
    if (!online || busy) return;

    recognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
      setInterim("");
      haptic("selection", haptics);
    };
    recognition.onresult = (event: any) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) finalChunk += value;
        else interimChunk += value;
      }
      if (finalChunk.trim()) {
        setTranscript((current) => `${current}${current.trim() ? " " : ""}${finalChunk.trim()}`);
      }
      setInterim(interimChunk.trim());
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      setInterim("");
      const reason = event?.error === "not-allowed"
        ? "Microphone permission was denied. Enable microphone access in iPhone Settings or use keyboard dictation."
        : "Voice input stopped before it could finish. Try again.";
      setError(reason);
      haptic("error", haptics);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop?.();
    haptic("impact-light", haptics);
  }

  function resetAndClose() {
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    setListening(false);
    setTranscript("");
    setInterim("");
    setError(null);
    onClose();
  }

  function cancel() {
    haptic("impact-light", haptics);
    resetAndClose();
  }

  function useTranscript() {
    if (!combined) return;
    onUseTranscript(combined);
    haptic("success", haptics);
    resetAndClose();
  }

  function sendTranscript() {
    if (!combined || busy || !online) return;
    const text = combined;
    haptic("impact-light", haptics);
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    setListening(false);
    setTranscript("");
    setInterim("");
    setError(null);
    onSendTranscript(text, speakReply);
    onClose();
  }

  function focusKeyboardDictation() {
    cancel();
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Navi"]')?.focus();
    }, 80);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-overlay backdrop-blur-[5px] md:items-center md:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Navi voice mode"
        className="menu-enter safe-top flex max-h-[calc(100dvh-8px)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--border-subtle)] bg-elev-1 shadow-sheet md:max-h-[760px] md:rounded-[28px] md:border"
      >
        <header className="flex min-h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--selection-bg)] text-accent">
            <Volume2 size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px]/6 font-semibold text-primary">Voice mode</span>
            <span className="block text-[11px]/4 font-medium text-tertiary">Speak one turn, review it, then send or cancel</span>
          </span>
          <button type="button" onClick={cancel} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close voice mode">
            <X size={20} />
          </button>
        </header>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <label className="block text-[12px]/4 font-semibold text-secondary" htmlFor="voice-language">Dictation language</label>
          <select
            id="voice-language"
            value={language}
            onChange={(event) => persistLanguage(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-3 text-[15px]/5 font-medium text-primary outline-none focus:border-accent"
          >
            {LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>

          <div className="mt-5 rounded-[24px] border border-[var(--border-subtle)] bg-elev-2 p-4">
            <div className="flex min-h-[132px] items-center justify-center">
              {combined ? (
                <p className="w-full whitespace-pre-wrap text-[18px]/7 font-medium tracking-[-0.01em] text-primary">{combined}</p>
              ) : (
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-elev-3 text-secondary">
                    <Mic size={27} />
                  </div>
                  <p className="mt-3 text-[14px]/5 font-medium text-tertiary">Tap Start and speak naturally.</p>
                </div>
              )}
            </div>

            {listening ? (
              <div className="mt-4 flex h-8 items-center justify-center gap-1" aria-label="Listening">
                {[0, 1, 2, 3, 4, 5, 6].map((item) => (
                  <span
                    key={item}
                    className="w-1.5 animate-pulse rounded-full bg-accent"
                    style={{ height: `${12 + ((item * 7) % 18)}px`, animationDelay: `${item * 80}ms` }}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {error ? <div className="mt-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[12px]/4 font-medium text-danger" role="alert">{error}</div> : null}
          {!online ? <div className="mt-3 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 p-3 text-[12px]/4 font-medium text-warning">Voice turns require a connection. Keyboard dictation can still fill the saved local draft.</div> : null}

          <button
            type="button"
            role="switch"
            aria-checked={speakReply}
            onClick={() => {
              setSpeakReply((value) => !value);
              haptic("selection", haptics);
            }}
            className="mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left active:bg-elev-2"
          >
            <span className={`flex h-8 w-8 items-center justify-center rounded-full ${speakReply ? "bg-accent text-white" : "bg-elev-3 text-secondary"}`}>
              {speakReply ? <Check size={17} /> : <Volume2 size={17} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px]/5 font-semibold text-primary">Read Navi’s reply aloud</span>
              <span className="block text-[11px]/4 font-medium text-tertiary">Uses the browser’s on-device speech voice when available</span>
            </span>
          </button>

          {supported === false ? (
            <button type="button" onClick={focusKeyboardDictation} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-elev-2 px-4 text-[13px]/5 font-semibold text-primary active:bg-elev-3">
              <Keyboard size={18} />Use iPhone keyboard dictation
            </button>
          ) : null}
        </div>

        <footer className="border-t border-[var(--border-subtle)] px-4 pb-[calc(14px+var(--safe-bottom))] pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={listening ? stop : start}
              disabled={!online || busy || supported === false}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl text-[14px]/5 font-semibold disabled:opacity-45 ${listening ? "bg-elev-3 text-primary" : "bg-accent text-white active:bg-accent-pressed"}`}
            >
              {listening ? <Square size={14} fill="currentColor" /> : <Mic size={18} />}
              {listening ? "Stop" : "Start"}
            </button>
            <button type="button" onClick={useTranscript} disabled={!combined || busy} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-elev-2 text-[14px]/5 font-semibold text-primary active:bg-elev-3 disabled:opacity-45">
              <Check size={17} />Add to message
            </button>
          </div>
          <button type="button" onClick={sendTranscript} disabled={!combined || busy || !online} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[14px]/5 font-semibold text-app active:opacity-85 disabled:opacity-40">
            <Send size={17} />Send spoken turn to Navi
          </button>
          <p className="mt-2 text-center text-[10px]/4 font-medium text-tertiary">Composer microphone = quick dictation · Voice mode = reviewed spoken turn</p>
        </footer>
      </section>
    </div>
  );
}
