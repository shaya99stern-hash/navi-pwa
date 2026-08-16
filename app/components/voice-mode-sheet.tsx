"use client";

import { Check, Keyboard, LoaderCircle, Mic, Send, Square, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { resolveVoiceLanguage } from "@/lib/ui/speech";
import {
  recordingSupported,
  startRecording,
  type AutoStopReason,
  type RecordingSession
} from "@/lib/ui/recorder";
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
 * The one thing recognition did better has since been recovered. It streamed
 * words as they were spoken, and the first recording version could only
 * produce them at the end — so this sheet had to show the wait rather than the
 * words. The recorder now transcribes segment by segment while the microphone
 * is still open, so the text builds up as it is spoken and the spinner only
 * covers the last unfinished sentence.
 *
 * Endpointing is the recorder's too. This sheet used to run its own detector
 * over the level meter, with a fixed threshold that meant hands-free worked in
 * a quiet room and nowhere else — while the recorder was separately deciding,
 * with a measured noise floor, where speech began and ended. Two answers to
 * one question is how the two surfaces drift apart, so there is one now, and
 * it is the better one.
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
  /**
   * The transcript as a ref, because hands-free reads it from a callback.
   *
   * `stop()` is invoked from the recorder's level callback, which closes over
   * the render that started the recording — so a second pass appending to
   * `transcript` would append to whatever it was one turn ago. The state drives
   * the display and this drives the appending; `writeTranscript` is the only
   * thing that sets either, so they cannot drift.
   */
  const transcriptRef = useRef("");
  /**
   * The current pass's words, as they arrive.
   *
   * Separate from `transcript`, which holds the passes already finished. Start
   * / Stop / Start again is how a long thought gets spoken, and only a
   * completed pass is committed — so this is the sentence in flight and that
   * is everything before it.
   */
  const [live, setLive] = useState("");
  /** Between stopping and the last sentence arriving. Its own state, because it
      is its own thing to look at — not a variety of idle. */
  const [transcribing, setTranscribing] = useState(false);
  const [listening, setListening] = useState(false);
  /** Whether the detector is hearing a voice, rather than merely a level. */
  const [speaking, setSpeaking] = useState(false);
  /** Live microphone level, so the bars respond to the voice rather than a timer. */
  const [level, setLevel] = useState(0);
  /* Levels arrive fifty times a second and the bars redraw sixty; holding the
     peak in a ref and draining it on a timer keeps a seven-bar row from
     costing fifty React renders a second. */
  const peakRef = useRef(0);
  const [speakReply, setSpeakReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Hands-free. Off by default, and that is deliberate rather than timid: it
   * holds the microphone open across a whole conversation, which is not
   * something to switch on for someone without asking.
   */
  const [conversation, setConversation] = useState(false);
  /**
   * True while the reply is being read aloud, so listening waits for it.
   *
   * Named for the app talking, not for the person: `speaking` above is the
   * detector's answer about the microphone, and hands-free depends on telling
   * those two apart — the whole failure it exists to prevent is the app
   * transcribing its own voice back as the next question.
   */
  const [reading, setReading] = useState(false);
  /* Guards the restart. `busy`, `reading` and `listening` all settle at
     slightly different moments, and without this the effect that restarts
     listening can fire twice on the same gap and open two recorders. */
  const restarting = useRef(false);

  /* What is shown, and what Send would send: the finished passes plus the one
     still being spoken. */
  const combined = useMemo(
    () => `${transcript}${transcript.trim() && live ? " " : ""}${live}`.trim(),
    [transcript, live]
  );

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

  /** The one place either copy of the transcript is written. */
  function writeTranscript(next: string) {
    transcriptRef.current = next;
    setTranscript(next);
  }

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
    setLive("");
    try {
      recorderRef.current = await startRecording({
        onLevel: (value) => { peakRef.current = Math.max(peakRef.current, value); },
        onSpeaking: setSpeaking,
        /* The words as they are spoken. This is what the sheet used to have
           with recognition, lose with recording, and show a spinner in place
           of. */
        onTranscript: setLive,
        /**
         * Hands-free, decided by the same detector that decides where a
         * segment is cut rather than by a second one reading the level meter.
         *
         * Passed at start time and not read from a closure afterwards, which
         * is why toggling the switch mid-turn restarts the recording instead
         * of quietly having no effect until the next one.
         */
        handsFree: conversation,
        onAutoStop: (reason: AutoStopReason) => {
          /* Nothing was said, so there is no clip worth transcribing — stop
             and let the restart effect open a fresh turn. Every other reason
             means there is something worth keeping: a finished turn, the
             safety ceiling, or the microphone being taken by a call. */
          if (reason === "silent") void stop({ discard: true });
          else void stop();
        },
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
  async function stop({ discard = false }: { discard?: boolean } = {}) {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    haptic("impact-light", haptics);
    setListening(false);
    setSpeaking(false);
    setLevel(0);
    if (discard) { session.cancel(); setLive(""); return; }
    setTranscribing(true);
    try {
      const text = (await session.stop()).trim();
      /* The pass is over, so its words stop being provisional and become part
         of the turn below. Cleared before the merge rather than after, so the
         sentence is never counted in both places for a frame. */
      setLive("");
      if (!text) {
        /* In conversation mode this is a non-event: the room was noisy enough
           to open a turn and there were no words in it. Saying so every few
           seconds, hands-free, would be its own kind of broken. */
        if (!conversation) setError("Nothing was picked up. Try again a little closer to the microphone.");
        return;
      }
      /* Appends rather than replaces, read from the ref so a second pass adds
         to the turn rather than to a stale copy of it. */
      const current = transcriptRef.current;
      const merged = `${current}${current.trim() ? " " : ""}${text}`.trim();
      writeTranscript(merged);
      /* The review step is what makes this dictation. With hands-free on, the
         turn goes as soon as the words exist. */
      if (conversation && online && !busy) send(merged);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be transcribed.");
      haptic("error", haptics);
    } finally {
      setTranscribing(false);
    }
  }

  /**
   * Open the next turn once the exchange has fully settled.
   *
   * Three things have to be finished, and they finish at different moments:
   * the request (`busy`), the reply being read aloud (`reading`), and this
   * sheet's own recorder. Restarting on any one of them alone is how a
   * conversation ends up listening to itself — the microphone opens while the
   * reply is still playing out of the speaker, transcribes it, and sends it
   * back as the next question.
   */
  useEffect(() => {
    if (!open || !conversation || !online) return;
    if (busy || reading || listening || transcribing || restarting.current) return;
    restarting.current = true;
    /* A beat before reopening. Without it the microphone catches the tail of
       the speaker and the first syllable of the reply becomes the next turn. */
    const timer = window.setTimeout(() => {
      restarting.current = false;
      void start();
    }, 450);
    return () => { window.clearTimeout(timer); restarting.current = false; };
  }, [busy, conversation, listening, online, open, reading, transcribing]);

  /**
   * Whether the reply is still being read aloud.
   *
   * `speechSynthesis` has no reliable end event across engines — the same
   * reason `message-row` polls it rather than listening for one. Polled only
   * while hands-free is on, so an idle sheet costs nothing.
   */
  useEffect(() => {
    if (!open || !conversation || !speakReply || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const poll = window.setInterval(() => setReading(window.speechSynthesis.speaking), 300);
    return () => { window.clearInterval(poll); setReading(false); };
  }, [conversation, open, speakReply]);

  /* The microphone level, drained at the rate the bars actually redraw. */
  useEffect(() => {
    if (!listening) { peakRef.current = 0; setLevel(0); return; }
    const timer = window.setInterval(() => {
      setLevel(peakRef.current);
      peakRef.current = 0;
    }, 60);
    return () => window.clearInterval(timer);
  }, [listening]);

  function resetAndClose() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setSpeaking(false);
    setTranscribing(false);
    setLevel(0);
    setLive("");
    writeTranscript("");
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

  /**
   * Hand a turn to the conversation.
   *
   * One path for both the Send button and the hands-free auto-send, because
   * they must clear exactly the same state — the earlier version cleared it
   * inline, and a second caller doing "nearly the same" is how a stale
   * transcript ends up prepended to the next turn.
   */
  function send(text: string) {
    if (!text || busy || !online) return;
    haptic("impact-light", haptics);
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setListening(false);
    setSpeaking(false);
    setTranscribing(false);
    setLevel(0);
    setLive("");
    writeTranscript("");
    setError(null);
    onSendTranscript(text, speakReply);
  }

  function sendTranscript() {
    if (!combined || busy || !online) return;
    send(combined);
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
                /* The text builds up here while it is still being spoken, so
                   this is the ordinary case rather than the after-the-fact
                   one. The tail of the current pass is dimmed: it can still
                   change as the last segment settles, and showing that is
                   better than having a settled-looking sentence rewrite
                   itself. */
                <p className="w-full whitespace-pre-wrap text-[1.125rem]/7 font-medium tracking-[-0.01em] text-primary">
                  {transcript}
                  {transcript.trim() && live ? " " : ""}
                  <span className={listening ? "text-secondary" : undefined}>{live}</span>
                </p>
              ) : transcribing ? (
                /* Only reachable now when the very first sentence has not come
                   back yet. It used to cover every recording end to end. */
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
                 watching it is asking.

                 The colour carries the detector's own answer, which is a
                 stronger statement than the height: bars can move on room
                 noise, and this only lights when what is being heard is going
                 to be transcribed. */
              <div
                className="mt-4 flex h-8 items-end justify-center gap-1"
                role="status"
                aria-label={speaking ? "Listening, speech detected" : "Listening"}
              >
                {VOICE_BARS.map((weight, index) => (
                  <span
                    key={index}
                    className={`w-1.5 rounded-full transition-[height,background-color] duration-100 ${speaking ? "bg-accent" : "bg-[var(--border-strong)]"}`}
                    style={{ height: `${Math.max(5, Math.min(30, 5 + level * weight * 34))}px` }}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {error ? <div className="mt-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.75rem]/4 font-medium text-danger" role="alert">{error}</div> : null}
          {!online ? <div className="mt-3 rounded-2xl border border-[var(--accent-warning)] bg-elev-2 p-3 text-[0.75rem]/4 font-medium text-warning">Voice turns require a connection. Keyboard dictation can still fill the saved local draft.</div> : null}

          {/* Hands-free. Above the read-aloud switch because it is the larger
              change — it turns four deliberate acts per turn into none — and
              because it depends on that one: a conversation you cannot hear is
              not a conversation. Off by default; holding the microphone open
              across a whole exchange is not something to start unasked. */}
          <button
            type="button"
            role="switch"
            aria-checked={conversation}
            onClick={() => {
              setConversation((value) => {
                const next = !value;
                /* Reading the reply aloud is what closes the loop, so turning
                   this on turns that on rather than leaving someone in a
                   hands-free conversation with a silent partner. */
                if (next) setSpeakReply(true);
                /* Either direction ends the current recording, because
                   hands-free is decided when the recorder is opened. Switching
                   it on mid-turn without this looks like it did nothing: the
                   open recording keeps waiting for Stop, and only the turn
                   after it listens for itself. Discarding lets the restart
                   effect reopen with the setting that is now switched on. */
                if (listening) void stop({ discard: true });
                return next;
              });
              haptic("selection", haptics);
            }}
            className="mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left active:bg-elev-2"
          >
            <span className={`flex h-8 w-8 items-center justify-center rounded-full ${conversation ? "bg-accent text-white" : "bg-elev-3 text-secondary"}`}>
              {conversation ? <Check size={17} /> : <Mic size={17} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.875rem]/5 font-semibold text-primary">Hands-free conversation</span>
              <span className="block text-[0.6875rem]/4 font-medium text-tertiary">
                {conversation
                  ? "Speak, pause, and it answers. Listening resumes on its own."
                  : "Sends when you stop speaking, then listens again — no buttons"}
              </span>
            </span>
          </button>

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
