"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { primeSpeech, resolveVoiceLanguage, speakBest, type SpokenEngine, type SpokenHandle } from "@/lib/ui/speech";
import { recordingSupported, startRecording, type AutoStopReason, type RecordingSession } from "@/lib/ui/recorder";

/**
 * One tap, then a conversation.
 *
 * The old voice mode was a sheet with a Start button, a Stop button, a Send
 * button, a hands-free switch and a read-aloud switch — five decisions between
 * wanting to say something and having said it. This is the same machinery with
 * the decisions removed: the microphone opens, a pause ends the turn, the reply
 * is spoken, and the microphone opens again. Nothing to press until it is over.
 *
 * ## Half-duplex, on purpose
 *
 * The microphone is never open while the reply is playing. The alternative —
 * listening through the answer so it can be interrupted — needs the app to tell
 * its own voice from the person's on a phone speaker, and everything that gets
 * it wrong gets it wrong in the same way: the app hears itself, transcribes it,
 * and asks itself the next question. So the loop waits for `done` on the spoken
 * handle before reopening, and the one thing lost is barge-in.
 *
 * ## Where the state lives
 *
 * Here, not in the composer. The loop needs three things that belong to the
 * screen above it — whether a request is in flight, what the last finished
 * answer was, and how to send a turn — so a hook that takes those as arguments
 * can be driven by the shell and rendered by the composer without either of
 * them owning the loop.
 */

export type ConversationPhase =
  /** Not running. */
  | "off"
  /** Microphone open, waiting for a pause. */
  | "listening"
  /** The last sentence is still being written down. */
  | "transcribing"
  /** The turn is with Navi Soul. */
  | "thinking"
  /** The reply is being read aloud, and the microphone is closed. */
  | "speaking";

/** The newest finished assistant message, or null while one is being written. */
export type ConversationReply = { id: string; text: string } | null;

export type VoiceConversation = {
  active: boolean;
  phase: ConversationPhase;
  /** The words of the turn being spoken, as they arrive. */
  transcript: string;
  /** Live microphone level, 0 to 1. Zero unless listening. */
  level: number;
  /** Whether the detector believes a voice is present, rather than a level. */
  hearing: boolean;
  error: string | null;
  /**
   * Which voice last spoke, and why it was not the good one.
   *
   * On screen, because "it does not talk" had four indistinguishable causes and
   * every one of them was invisible from both sides — no credential, over
   * budget, no audio, playback refused. Naming it turns the next report into a
   * fact instead of a hunt.
   */
  voice: { engine: SpokenEngine; why: string } | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

type Options = {
  online: boolean;
  /** A request is in flight. The loop will not speak or listen across one. */
  busy: boolean;
  /** The stored dictation preference, passed through as given. */
  language: string;
  /** How fast to read the reply, as a multiplier of normal. */
  rate: number;
  haptics: boolean;
  reply: ConversationReply;
  /**
   * When the last request failed, as a timestamp that changes per failure.
   *
   * Without this the loop learns nothing from a turn that errored: it waits in
   * `thinking` for a reply that is never coming, and the person is left
   * watching a microphone that is shut and a status line that says the app is
   * working. The only recovery was the unanswered-turn timer, which is a
   * six-second silence *after* however long the request took to fail — and a
   * provider timeout takes the whole request budget to get there.
   */
  failedAt?: number | null;
  /** Hand a finished turn to the conversation. */
  onTurn: (text: string) => void;
};

/**
 * The gap between one part of the exchange ending and the microphone opening.
 *
 * Long enough that the tail of the speaker does not become the first syllable
 * of the next question, short enough that it reads as a pause rather than a
 * wait.
 */
const REOPEN_DELAY_MS = 420;

/**
 * How long a turn may sit unanswered before the microphone opens again.
 *
 * Only ever armed while no request is in flight, so a genuinely slow answer
 * cannot trip it — this covers the case where the send failed outright and no
 * reply is ever coming, which would otherwise leave the loop waiting forever
 * with no microphone and no sound.
 */
const UNANSWERED_MS = 6_000;

/** Read aloud, a code block is a wall of punctuation. */
export function spokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " There is code on screen. ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function useVoiceConversation(options: Options): VoiceConversation {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<ConversationPhase>("off");
  const [transcript, setTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState<{ engine: SpokenEngine; why: string } | null>(null);

  const recorderRef = useRef<RecordingSession | null>(null);
  const spokenRef = useRef<SpokenHandle | null>(null);
  /**
   * The last assistant message this loop has already dealt with.
   *
   * Seeded when the conversation starts, so opening it in a thread that
   * already has answers in it does not begin by reading the last one aloud.
   */
  const answeredRef = useRef<string | null>(null);
  /* The failure already acted on. Without it, the effect below re-fires every
     time the phase changes and kills the *next* turn with the last one's
     error. */
  const handledFailureRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const phaseRef = useRef<ConversationPhase>("off");
  const peakRef = useRef(0);
  /* Read from callbacks that were created several turns ago, so they must be
     refs rather than closed-over values. */
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setPhaseBoth = useCallback((next: ConversationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /* Everything the loop holds open, released in one place. Called by `stop`,
     by unmount, and by a failure that ends the conversation — three callers
     doing nearly the same thing is how a microphone gets left on. */
  const release = useCallback(() => {
    /* Cleared before it is cancelled, not after. Cancelling can end the
       recorder's own turn detection, and a callback that fires on the way out
       would otherwise find a session still in the ref and try to transcribe
       the recording that was just thrown away. */
    const session = recorderRef.current;
    recorderRef.current = null;
    session?.cancel();
    const spoken = spokenRef.current;
    spokenRef.current = null;
    spoken?.stop();
    peakRef.current = 0;
    setLevel(0);
    setHearing(false);
    setTranscript("");
  }, []);

  const listen = useCallback(async () => {
    if (!activeRef.current || recorderRef.current) return;
    const { online, language } = optionsRef.current;
    if (!online) return;

    setTranscript("");
    setPhaseBoth("listening");
    try {
      recorderRef.current = await startRecording({
        /* Hands-free is the whole point here: the pause ends the turn, and it
           is the recorder's own detector — with a measured noise floor —
           deciding where that is, rather than a second one reading the level
           meter and disagreeing with it. */
        handsFree: true,
        language,
        onLevel: (value) => { peakRef.current = Math.max(peakRef.current, value); },
        onSpeaking: setHearing,
        onTranscript: setTranscript,
        onError: (message) => setError(message),
        onAutoStop: (reason: AutoStopReason) => {
          /* Nothing was said. The room was loud enough to open a turn and had
             no words in it, which in a conversation is a non-event rather than
             something to report. */
          void endTurnRef.current({ discard: reason === "silent" });
        }
      });
    } catch (caught) {
      /* The recorder distinguishes a refused permission from a missing device
         and names the remedy for each, so its message is passed through rather
         than replaced. A conversation that cannot open a microphone is over. */
      setError(caught instanceof Error ? caught.message : "The microphone could not be opened.");
      activeRef.current = false;
      setActive(false);
      setPhaseBoth("off");
      release();
    }
  }, [release, setPhaseBoth]);

  /* Reopening is always deferred by a beat, and always through here, so the
     tail of whatever just finished cannot be caught by what comes next. */
  const relisten = useCallback(() => {
    if (!activeRef.current) return;
    window.setTimeout(() => { void listen(); }, REOPEN_DELAY_MS);
  }, [listen]);

  /**
   * Close the microphone and do something with what was said.
   *
   * Held in a ref because the recorder's own auto-stop callback calls it, and
   * that callback was created when the recording opened — a direct reference
   * would be the version of this function from the turn before.
   */
  const endTurnRef = useRef<(input?: { discard?: boolean }) => Promise<void>>(async () => {});
  endTurnRef.current = async ({ discard = false } = {}) => {
    const session = recorderRef.current;
    recorderRef.current = null;
    if (!session) return;

    peakRef.current = 0;
    setLevel(0);
    setHearing(false);

    if (discard) {
      session.cancel();
      setTranscript("");
      relisten();
      return;
    }

    setPhaseBoth("transcribing");
    let text = "";
    try {
      text = (await session.stop()).trim();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be transcribed.");
    }
    setTranscript("");

    if (!activeRef.current) return;
    if (!text) { relisten(); return; }

    const { busy, online, haptics, onTurn } = optionsRef.current;
    if (busy || !online) { relisten(); return; }

    haptic("impact-light", haptics);
    setPhaseBoth("thinking");
    onTurn(text);
  };

  const start = useCallback(() => {
    if (activeRef.current) return;
    if (!recordingSupported()) {
      setError("This browser cannot record audio.");
      return;
    }
    /**
     * Spend this tap on the audio element that will speak the replies.
     *
     * iOS grants playback to an element inside a gesture, and every reply
     * after the first arrives without one. Priming here is the difference
     * between a conversation and a single spoken answer followed by silence.
     */
    primeSpeech();
    setError(null);
    /* Whatever is already on screen has been answered as far as this loop is
       concerned — it opens by listening, not by reading the thread back. */
    answeredRef.current = optionsRef.current.reply?.id ?? null;
    activeRef.current = true;
    setActive(true);
    haptic("selection", optionsRef.current.haptics);
    void listen();
  }, [listen]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setPhaseBoth("off");
    release();
    haptic("selection", optionsRef.current.haptics);
  }, [release, setPhaseBoth]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [start, stop]);

  /**
   * Read the answer aloud, then listen again.
   *
   * The reply arriving is what advances the loop, which is why this is an
   * effect on the reply rather than something awaited after `onTurn`: the
   * request belongs to the screen above, and the answer streams in over
   * however long it takes.
   *
   * ## The phase is read from the ref, and that is load-bearing
   *
   * With `phase` in the dependency array this effect cancelled itself, every
   * time, and the whole feature was silent:
   *
   *   1. it runs with the phase at `thinking`, sets `cancelled = false`,
   *      switches the phase to `speaking`, and starts fetching the audio;
   *   2. the phase it just set is a dependency, so React tears the effect down
   *      and its cleanup sets `cancelled = true`;
   *   3. it re-runs, sees a phase that is no longer `thinking`, and returns;
   *   4. the audio arrives, finds `cancelled`, and is stopped in the same tick
   *      it became ready — so nothing plays, and because the early return skips
   *      `await handle.done`, `relisten` never runs and the microphone stays
   *      shut on `speaking` for ever.
   *
   * Every symptom of that is a symptom of something else: no sound reads as a
   * muted element or a missing credential, and a stuck phase reads as a hung
   * request. It was none of those. An effect that sets a value it depends on is
   * an effect that runs once and undoes itself.
   */
  useEffect(() => {
    if (!active || options.busy) return;
    if (phaseRef.current !== "thinking") return;
    const reply = options.reply;
    if (!reply || reply.id === answeredRef.current) return;

    answeredRef.current = reply.id;
    const words = spokenText(reply.text);
    if (!words) { relisten(); return; }

    let cancelled = false;
    setPhaseBoth("speaking");
    void (async () => {
      const handle = await speakBest(words, resolveVoiceLanguage(optionsRef.current.language), optionsRef.current.rate);
      /* Recorded before the audio is awaited, so it is on screen while the
         reply is playing rather than after it has finished. */
      setVoice({ engine: handle.engine, why: handle.why });
      /* Stopped while the audio was being fetched. Without this the reply
         starts playing after the conversation was closed, with nothing left
         holding a reference to silence it. */
      if (cancelled || !activeRef.current) { handle.stop(); return; }
      spokenRef.current = handle;
      await handle.done;
      spokenRef.current = null;
      if (cancelled || !activeRef.current) return;
      relisten();
    })();

    return () => { cancelled = true; };
  }, [active, options.busy, options.reply, relisten, setPhaseBoth]);

  /**
   * A turn that failed outright ends the wait now, rather than in six seconds.
   *
   * Read from `phaseRef` rather than from `phase` so the phase does not have to
   * be a dependency — with it, the effect re-runs on every phase change and
   * would apply a stale failure to a turn that has not failed.
   */
  useEffect(() => {
    const failedAt = options.failedAt;
    if (!active || !failedAt || failedAt === handledFailureRef.current) return;
    handledFailureRef.current = failedAt;
    if (phaseRef.current !== "thinking") return;
    setError("That turn did not get through. Listening again.");
    relisten();
  }, [active, options.failedAt, relisten]);

  /**
   * A turn that was never answered must not end the conversation silently.
   *
   * Armed only while nothing is in flight, so a slow answer cannot trip it;
   * what it catches is a send that failed before it started, where no reply is
   * coming and the loop would otherwise wait with the microphone shut.
   */
  useEffect(() => {
    if (!active || options.busy || phase !== "thinking") return;
    const timer = window.setTimeout(() => {
      if (activeRef.current && phaseRef.current === "thinking") relisten();
    }, UNANSWERED_MS);
    return () => window.clearTimeout(timer);
  }, [active, options.busy, phase, relisten]);

  /* The level, drained at the rate a waveform actually redraws. Fifty React
     renders a second to move a row of bars is measurable on a phone. */
  useEffect(() => {
    if (phase !== "listening") { peakRef.current = 0; setLevel(0); return; }
    const timer = window.setInterval(() => {
      setLevel(peakRef.current);
      peakRef.current = 0;
    }, 60);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* Going offline mid-conversation ends it rather than leaving a microphone
     open against a connection that cannot carry the audio anywhere. */
  useEffect(() => {
    if (active && !options.online) stop();
  }, [active, options.online, stop]);

  /* A recording or a reply left running past unmount holds the microphone open
     and keeps the browser's recording indicator lit. */
  useEffect(() => () => {
    activeRef.current = false;
    release();
  }, [release]);

  return { active, phase, transcript, level, hearing, error, voice, start, stop, toggle };
}
