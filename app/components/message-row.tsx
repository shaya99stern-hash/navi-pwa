"use client";

import type { UIMessage } from "ai";
import { Check, Copy, FileText, RotateCcw, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { messageText } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { speakBest, type SpokenHandle } from "@/lib/ui/speech";
import { MarkdownRenderer, type CapabilityHandlers } from "./markdown-renderer";
import { MessageBoundary } from "./message-boundary";
import { ExecutionTrace, executionRuns } from "./execution-trace";
import { ToolActivityList, toolActivity } from "./tool-activity";
import { PlanCard, planFor } from "./plan-card";
import { EngineNote, engineNoteFor } from "./engine-note";
import { ReasoningDisclosure, ReasoningTrace, hadReasoning, reasoningFor } from "./reasoning-disclosure";

function messageFiles(message: UIMessage): Array<{ filename?: string; mediaType?: string }> {
  return message.parts.filter((part) => part.type === "file").map((part) => part as unknown as { filename?: string; mediaType?: string });
}

type Props = {
  message: UIMessage;
  streaming: boolean;
  /** Only the final response carries the brand mark under its action bar. */
  last: boolean;
  /**
   * Near the bottom of the thread, so kept out of `content-visibility`.
   *
   * `contain-intrinsic-size: auto 220px` remembers a row's height once it has
   * been measured, but a row that has never been on screen only has the 220px
   * guess. Scrolling up through a run of those makes WebKit correct its
   * estimate mid-gesture, and the thread shifts under a moving finger — the
   * one scroll artefact that reads as the app being broken rather than slow.
   * The last stretch of the thread is what actually gets scrolled, so it opts
   * out and pays full layout for a bounded number of rows.
   */
  recent: boolean;
  theme: "dark" | "light";
  chatFont: "serif" | "sans";
  haptics: boolean;
  voiceLanguage: string;
  voiceRate: number;
  rating?: "up" | "down";
  /** Takes the id so the shell can pass one stable handler to every row. */
  onRate?: (messageId: string, value: "up" | "down") => void;
  onRetry?: () => void;
  onLongPress?: (message: { id: string; text: string; role: string }) => void;
  capabilities?: CapabilityHandlers;
};

/**
 * Memoised, because the draft lives one component up.
 *
 * Every keystroke in the composer sets state in the shell, which renders the
 * conversation and the composer together — so typing one character re-rendered
 * every message on screen, markdown and code highlighting included. Measured at
 * 390x844: forty-three characters cost 1.7s against the 0.86s the typing itself
 * took, about twenty milliseconds of work per key. That is what "slow" is.
 *
 * A message that is not streaming does not change while you type, so it does
 * not need to re-render. The comparison below is explicit rather than the
 * default shallow one because two props are recreated every render by
 * construction — `onRetry` is only present on the last row — and a shallow
 * compare would find them different every time and memoise nothing at all.
 */
function MessageRowBase({ message, streaming, last, recent, theme, chatFont, haptics, voiceLanguage, voiceRate, rating, onRate, onRetry, onLongPress, capabilities }: Props) {
  const text = messageText(message);
  const files = messageFiles(message);
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /**
   * Which voice spoke, kept only when it was not the premium one.
   *
   * This button is the isolated test for the whole speech path: one tap, no
   * conversation loop, the gesture still on the stack. If it is silent here it
   * is silent everywhere, and the reason belongs on screen — the same silence
   * has had four indistinguishable causes and each round of guessing at them
   * cost hours.
   */
  const [spokenBy, setSpokenBy] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  const beginHold = (event: ReactPointerEvent) => {
    if (!onLongPress || streaming || !text) return;
    holdStart.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = window.setTimeout(() => {
      // A drag is a selection gesture, not a press.
      if (window.getSelection()?.toString()) return;
      haptic("impact-medium", haptics);
      onLongPress({ id: message.id, text, role: message.role });
    }, 520);
  };

  const cancelHold = (event?: ReactPointerEvent) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (event && holdStart.current) {
      const moved = Math.abs(event.clientX - holdStart.current.x) + Math.abs(event.clientY - holdStart.current.y);
      if (moved > 12) holdStart.current = null;
    }
  };

  if (!text && files.length === 0 && !streaming) return null;

  async function copy() {
    // On the gesture, not after the clipboard write; see code-block.tsx.
    haptic("selection", haptics);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_300);
  }

  /* The handle for whatever is currently speaking. Premium audio is an
     `Audio` element and has to be stopped through its own handle;
     `speechSynthesis.cancel()` does nothing to it. */
  const spoken = useRef<SpokenHandle | null>(null);

  function readAloud() {
    if (speaking) {
      spoken.current?.stop();
      spoken.current = null;
      /* Both are cancelled regardless of which one was playing: the handle
         only knows about the voice it started, and a stale synthesis utterance
         left running is the bug where two voices talk over each other. */
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    haptic("selection", haptics);
    setSpeaking(true);
    const language = voiceLanguage === "auto" ? navigator.language || "en-US" : voiceLanguage;

    /* Started from the tap itself, which is what unlocks audio playback on iOS
       for the rest of the session. `done` settles when the utterance actually
       stops, whichever voice spoke it — that is `speakBest`'s job, not this
       component's. */
    void (async () => {
      const handle = await speakBest(text, language, voiceRate);
      /* Only the fallbacks are worth saying. Announcing the good voice every
         time would be noise on a button that is usually working. */
      setSpokenBy(handle.engine === "premium" ? null : handle.why);
      spoken.current = handle;
      await handle.done;
      /* Only the turn that is still current may clear the button: a second tap
         starts a new handle, and a late promise from the old one must not
         switch it off underneath. */
      if (spoken.current === handle) {
        spoken.current = null;
        setSpeaking(false);
      }
    })();
  }

  function rate(value: "up" | "down") {
    haptic(value === "up" ? "success" : "selection", haptics);
    onRate?.(message.id, value);
  }

  const action = "flex h-9 w-9 items-center justify-center rounded-full text-tertiary active:bg-elev-2";

  return (
    <article
      data-message-id={message.id}
      data-role={message.role}
      onPointerDown={beginHold}
      onPointerUp={cancelHold}
      onPointerCancel={() => cancelHold()}
      onPointerMove={cancelHold}
      /* `navi-message-row` lets the browser skip rendering rows that are far
         off screen. Deliberately not applied while streaming: the row is
         growing a character at a time, and giving a changing element a guessed
         intrinsic height is what makes scroll anchoring jump. Nor near the
         bottom, where scrolling actually happens — see `recent`. The finished
         rows further up are the ones worth skipping anyway. */
      className={`navi-message-enter flex ${streaming || recent ? "" : "navi-message-row"} ${user ? "justify-end" : "justify-start"}`}
    >
      {user ? (
        <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-[var(--bg-bubble-user)] px-4 py-2.5 text-[1rem]/[1.5rem] font-normal text-primary">
          {files.length ? <div className="mb-2 flex flex-wrap gap-1.5">{files.map((file, index) => <span key={`${file.filename}-${index}`} className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-elev-3 px-2 text-[0.6875rem]/[0.875rem] font-semibold text-secondary"><FileText size={13} />{file.filename ?? file.mediaType ?? "Attachment"}</span>)}</div> : null}
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
      ) : (
        <div className="group w-full">
          {/* Answers read in the display serif by default — the strongest
              single typographic signal of the target design — switchable to
              the system face in Settings → General → Chat font. */}
          {/* Above the answer, because it is what the answer rests on: the
              user sees the work was done before reading the claim.

              Two components rather than one: code execution has its own richer
              trace showing each repair attempt, and everything else gets the
              plain chip. `run_javascript` is filtered out of the generic list
              so a run never renders twice. */}
          {/* The plan comes first: it is what the work was measured against,
              and reading it before the answer is the point. */}
          {(() => { const plan = planFor(message); return plan ? <PlanCard plan={plan} /> : null; })()}
          {/* Then the thinking. Live it carries its own text; after a reload
              only the fact survives, because the trace is unsafe to replay to
              a model and is therefore not kept. */}
          {(() => {
            const thought = reasoningFor(message);
            if (thought) return <ReasoningDisclosure text={thought} streaming={streaming} haptics={haptics} />;
            return !streaming && hadReasoning(message) ? <ReasoningTrace /> : null;
          })()}
          <ToolActivityList
            activities={toolActivity(message).filter((activity) => activity.name !== "run_javascript")}
            haptics={haptics}
          />
          <ExecutionTrace runs={executionRuns(message)} haptics={haptics} />
          {/* The reply sits in a bubble of its own, facing the user's.
              A thread of bubbles on one side and bare prose on the other reads
              as a document with your own remarks pasted into it; two bubbles
              read as a conversation. The squared corner is the mirror of the
              user's, so the two lean toward each other.

              `w-fit` so a short answer hugs its text the way a sent message
              does, `max-w-full` so a long one — or a code block, or an
              artifact — still gets the whole measure. The cards above (plan,
              reasoning, tools) stay outside it: they are apparatus, not
              speech. */}
          {text || streaming ? (
            <div className="w-fit max-w-full rounded-[20px] rounded-bl-[6px] border border-[var(--border-subtle)] bg-surface px-4 py-3">
              <div className={`navi-markdown text-[1rem]/[1.625rem] font-normal ${chatFont === "serif" ? "navi-chat-serif" : ""} ${streaming ? "streaming-cursor" : ""}`}>
                {text ? (
                  /* One message failing to draw must not take the screen with
                     it. Without this the only boundary was Next's route-level
                     one, which replaces the whole page — so a single malformed
                     artifact payload threw the owner out of the conversation
                     they were having. */
                  <MessageBoundary text={text}>
                    <MarkdownRenderer text={text} theme={theme} haptics={haptics} capabilities={capabilities} />
                  </MessageBoundary>
                ) : null}
              </div>
            </div>
          ) : null}
          {!streaming && text ? (
            <>
              <div className="mt-1.5 flex min-h-9 items-center gap-1 opacity-100 transition-opacity duration-[120ms] md:opacity-0 md:group-hover:opacity-100">
                <button type="button" onClick={() => void copy()} className={action} aria-label={copied ? "Copied" : "Copy response"}>
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
                <button type="button" onClick={readAloud} className={`${action} ${speaking ? "!text-accent" : ""}`} aria-label={speaking ? "Stop reading aloud" : "Read aloud"} aria-pressed={speaking}>
                  <Volume2 size={16} />
                </button>
                <button type="button" onClick={() => rate("up")} className={`${action} ${rating === "up" ? "!text-accent" : ""}`} aria-label="Good response" aria-pressed={rating === "up"}>
                  <ThumbsUp size={16} className={rating === "up" ? "fill-current" : ""} />
                </button>
                <button type="button" onClick={() => rate("down")} className={`${action} ${rating === "down" ? "!text-accent" : ""}`} aria-label="Bad response" aria-pressed={rating === "down"}>
                  <ThumbsDown size={16} className={rating === "down" ? "fill-current" : ""} />
                </button>
                {onRetry ? (
                  <button type="button" onClick={() => { haptic("selection", haptics); onRetry(); }} className={action} aria-label="Retry response">
                    <RotateCcw size={16} />
                  </button>
                ) : null}
              </div>
              {/* Only when it was not the good voice, and only after a tap.
                  This button is the isolated test for the whole speech path —
                  one gesture, no conversation loop — so when it falls back, the
                  reason is worth a line rather than another round of guessing. */}
              {spokenBy ? (
                <p className="text-[0.6875rem]/4 font-medium text-tertiary" role="status">Read in this device&rsquo;s voice — {spokenBy}</p>
              ) : null}
              {/* The mark and, beside it, which engine actually answered.
                  The mark alone was decorative — the one place under a reply
                  that could have said something said nothing, while the app
                  routed across a dozen models in silence. The note is always
                  visible, unlike the action row above it, because it is
                  information about the reply rather than a control for it. */}
              <div className="ml-2.5 mt-1 flex items-center gap-2">
                {last ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/brand-spark.png" alt="" aria-hidden="true" className="h-[14px] w-[14px] opacity-70" />
                ) : null}
                {(() => { const note = engineNoteFor(message); return note ? <EngineNote note={note} /> : null; })()}
              </div>
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}

export const MessageRow = memo(MessageRowBase, (previous, next) => {
  /* A streaming row changes on every chunk; nothing about it is stable, so
     comparing is wasted work on the one row that always has to render. */
  if (previous.streaming || next.streaming) return false;
  return previous.message === next.message
    && previous.last === next.last
    /* Rows fall out of the recent window as the thread grows, and that changes
       the class they render — a comparator that ignored it would leave the
       containment off for the whole history. */
    && previous.recent === next.recent
    && previous.theme === next.theme
    && previous.chatFont === next.chatFont
    && previous.haptics === next.haptics
    && previous.voiceLanguage === next.voiceLanguage
    && previous.rating === next.rating
    && previous.capabilities === next.capabilities
    /* Presence, not identity. What changes what a row draws is whether it can
       be rated or retried at all — and the shell keeps these identities stable
       anyway, so a difference here means the answer to that question changed. */
    && Boolean(previous.onRate) === Boolean(next.onRate)
    && Boolean(previous.onRetry) === Boolean(next.onRetry)
    && Boolean(previous.onLongPress) === Boolean(next.onLongPress);
});
