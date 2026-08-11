"use client";

import { Check, Keyboard, LoaderCircle, Mic, Send, Square, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { resolveVoiceLanguage } from "@/lib/ui/speech";
import { recordingSupported, startRecording, type RecordingSession } from "@/lib/ui/recorder";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * Voice mode records and has the audio transcribed, the same as the composer.
 *
 * It was the last thing still calling `webkitSpeechRecognition` — the API that
 * was removed from the composer precisely because it does not work here. In an
 * installed iOS PWA it is frequently absent with no error and no event, it
 * plays a system chime the page cannot suppress, and it ends sessions in ways
 * nothing can observe. Fixing the composer and leaving this behind meant the
 * microphone worked or did not depending on which button was pressed, which is
 * worse than either answer on its own.
 *
 * One consequence is visible and worth stating: recognition streamed words as
 * you spoke, and recording cannot. The transcript arrives when you stop. So the
 * waiting is shown rather than hidden — an empty panel between speaking and
 * text reads as the recording having been thrown away.
 */

const LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "he-IL", label: "Hebrew" },
  { id: "es-ES", label: "Spanish" },
  { id: "fr-FR", label: "French" }
] as const;

/* Fixed per-bar weights. The height comes from the live microphone level; these
   only vary the shape so the row reads as a waveform rather than a block. */
const VOICE_BARS = [0.55, 0.8, 1, 0.7, 1, 0.85, 0.6];

type Props = {
  open: boolean;
  busy: boolean;
  online: boolean;
  haptics: boolean;
  /** The one stored preference. This sheet used to keep its own copy in
      localStorage, which Settings then had to mirror into on every change. */
  voiceLanguage: string;
  onVoiceLanguage: (language: string) => void;
  onClose: () => void;
  onUseTranscript: (text: string) => void;
  onSendTranscript: (text: string, speakReply: boolean) => void;
};

export function VoiceModeSheet({
  open,
  busy,
  online,
  haptics,
  voiceLanguage,
  onVoiceLanguage,
  onClose,
  onUseTranscript,
  onSendTranscript
}: Props) {
  const recorderRef = useRef<RecordingSession | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const language = resolveVoiceLanguage(voiceLanguage);
  const [transcript, setTranscript] = useState("");
  /** Between stopping and the words arriving. Its own state, because it is its
      own thing to look at — not a variety of idle. */
  const [transcribing, setTranscribing] = useState(false);
  const [listening, setListening] = useState(false);
  /** Live microphone level, so the bars respond to the voice rather than a timer. */
  const [level, setLevel] = useState(0);
  const [speakReply, setSpeakReply] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const combined = useMemo(() => transcript.trim(), [transcript]);

  /* Swipe down to dismiss, like every other bottom sheet in the app.
     This one was the exception — same shape, same position, and the gesture
     that closed the others did nothing here. An affordance that works
     everywhere except one place is worse than one that works nowhere, because
     nothing tells you which place you are in. */
  const sheet = useSheetDrag({ open, onDismiss: () => resetAndClose(), haptics });

  useEffect(() => {
    if (!open) return;
    setSupported(recordingSupported());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setListening(false);
      setTranscribing(false);
      setLevel(0);
    }
  }, [open]);

  /* A recording left running when the sheet unmounts holds the microphone open
     and keeps the browser's recording indicator lit. */
  useEffect(() => () => recorderRef.current?.cancel(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function persistLanguage(next: string) {
    onVoiceLanguage(next);
    haptic("selection", haptics);
  }

  async function start() {
    if (!recordingSupported()) {
      setSupported(false);
      setError("This browser cannot record audio.");
      haptic("warning", haptics);
      return;
    }
    if (!online || busy || listening || transcribing) return;

    setError(null);
    try {
      recorderRef.current = await startRecording({
        onLevel: setLevel,
        onError: (message) => setError(message),
        /* The picker above now reaches the transcriber. It always stored a
           value and never sent it anywhere. */
        language: voiceLanguage
      });
      setListening(true);
      haptic("selection", haptics);
    } catch (caught) {
      /* Refused and unavailable are different problems with different
         remedies, and the recorder already distinguishes them. */
      setError(caught instanceof Error ? caught.message : "Recording could not start.");
      haptic("error", haptics);
    }
  }

  /* Appends rather than replaces: Start / Stop / Start again is how a long
     thought gets spoken, and each pass should add to the turn. */
  async function stop() {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    haptic("impact-light", haptics);
    setListening(false);
    setLevel(0);
    setTranscribing(true);
    try {
      const text = (await session.stop()).trim();
      if (text) setTranscript((current) => `${current}${current.trim() ? " " : ""}${text}`);
      else setError("Nothing was picked up. Try again a little closer to the microphone.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be transcribed.");
      haptic("error", haptics);
    } finally {
      setTranscribing(false);
    }
  }

  function resetAndClose() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setTranscribing(false);
    setLevel(0);
    setTranscript("");
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
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setTranscribing(false);
    setLevel(0);
    setTranscript("");
    setError(null);
    onSendTranscript(text, speakReply);
    onClose();
  }

  function focusKeyboardDictation() {
    cancel();
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat with Navi Soul"]')?.focus();
    }, 80);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center md:items-center md:p-4">
      <button
        type="button"
        aria-label="Dismiss voice mode"
        onClick={cancel}
        {...sheet.scrimProps}
        className="absolute inset-0 bg-overlay backdrop-blur-[5px]"
      />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Navi Soul voice mode"
        className="menu-enter safe-top relative flex max-h-[calc(100dvh-8px)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--border-subtle)] bg-elev-1 shadow-sheet md:max-h-[760px] md:rounded-[28px] md:border"
      >
        {/* The grab area, and only it: content below must still scroll. */}
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        <header className="flex min-h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--selection-bg)] text-accent">
            <Volume2 size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[1.0625rem]/6 font-semibold text-primary">Voice mode</span>
            <span className="block text-[0.6875rem]/4 font-medium text-tertiary">Speak one turn, review it, then send or cancel</span>
          </span>
          <button type="button" onClick={cancel} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close voice mode">
            <X size={20} />
          </button>
        </header>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <label className="block text-[0.75rem]/4 font-semibold text-secondary" htmlFor="voice-language">Dictation language</label>
          <select
            id="voice-language"
            value={language}
            onChange={(event) => persistLanguage(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-3 text-[0.9375rem]/5 font-medium text-primary outline-none focus:border-accent"
          >
            {LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>

          <div className="mt-5 rounded-[24px] border border-[var(--border-subtle)] bg-elev-2 p-4">
            <div className="flex min-h-[132px] items-center justify-center">
              {combined ? (
                <p className="w-full whitespace-pre-wrap text-[1.125rem]/7 font-medium tracking-[-0.01em] text-primary">{combined}</p>
              ) : transcribing ? (
                /* The gap recognition never had. Words used to appear as they
                   were spoken; recording can only produce them at the end, and
                   an empty panel in between reads as the recording having been
                   thrown away. */
                <div className="text-center" role="status">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-elev-3 text-accent">
                    <LoaderCircle size={26} className="animate-spin" />
                  </div>
                  <p className="mt-3 text-[0.875rem]/5 font-medium text-secondary">Writing down what you said…</p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-elev-3 text-secondary">
                    <Mic size={27} />
                  </div>
                  <p className="mt-3 text-[0.875rem]/5 font-medium text-tertiary">Tap Start and speak naturally.</p>
                </div>
              )}
            </div>

            {listening ? (
              /* Driven by the microphone rather than a CSS animation. A bar row
                 that pulses on a timer looks identical whether it is hearing
                 you or hearing nothing, which is exactly the question someone
                 watching it is asking. */
              <div className="mt-4 flex h-8 items-end justify-center gap-1" role="status" aria-label="Listening">
                {VOICE_BARS.map((weight, index) => (
                  <span
                    key={index}
                    className="w-1.5 rounded-full bg-accent transition-[height] duration-100"
                    style={{ height: `${Math.max(5, Math.min(30, 5 + level * weight * 34))}px` }}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {error ? <div className="mt-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.75rem]/4 font-medium text-danger" role="alert">{error}</div> : null}
          {!online ? <div className="mt-3 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 p-3 text-[0.75rem]/4 font-medium text-warning">Voice turns require a connection. Keyboard dictation can still fill the saved local draft.</div> : null}

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
              <span className="block text-[0.875rem]/5 font-semibold text-primary">Read Navi Soul’s reply aloud</span>
              <span className="block text-[0.6875rem]/4 font-medium text-tertiary">Uses the browser’s on-device speech voice when available</span>
            </span>
          </button>

          {/* Offered whenever recording is unavailable *or* has failed: a
              refused microphone is not a temporary condition, and the way out
              is the keyboard's own dictation key. */}
          {supported === false || error ? (
            <button type="button" onClick={focusKeyboardDictation} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-elev-2 px-4 text-[0.8125rem]/5 font-semibold text-primary active:bg-elev-3">
              <Keyboard size={18} />Use iPhone keyboard dictation
            </button>
          ) : null}
        </div>

        <footer className="border-t border-[var(--border-subtle)] px-4 pb-[calc(14px+var(--safe-bottom))] pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void (listening ? stop() : start())}
              disabled={!online || busy || supported === false || transcribing}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl text-[0.875rem]/5 font-semibold disabled:opacity-45 ${listening ? "bg-elev-3 text-primary" : "bg-accent text-white active:bg-accent-pressed"}`}
            >
              {transcribing ? <LoaderCircle size={16} className="animate-spin" /> : listening ? <Square size={14} fill="currentColor" /> : <Mic size={18} />}
              {transcribing ? "Writing…" : listening ? "Stop" : "Start"}
            </button>
            <button type="button" onClick={useTranscript} disabled={!combined || busy || transcribing} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-elev-2 text-[0.875rem]/5 font-semibold text-primary active:bg-elev-3 disabled:opacity-45">
              <Check size={17} />Add to message
            </button>
          </div>
          <button type="button" onClick={sendTranscript} disabled={!combined || busy || transcribing || !online} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[0.875rem]/5 font-semibold text-app active:opacity-85 disabled:opacity-40">
            <Send size={17} />Send spoken turn to Navi Soul
          </button>
          <p className="mt-2 text-center text-[0.625rem]/4 font-medium text-tertiary">Composer microphone = quick dictation · Voice mode = reviewed spoken turn</p>
        </footer>
      </section>
    </div>
  );
}
