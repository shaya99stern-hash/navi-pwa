"use client";

import type { UIMessage } from "ai";
import { Check, Copy, FileText, RotateCcw, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { messageText } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { speak, whenVoicesReady } from "@/lib/ui/speech";
import { MarkdownRenderer, type CapabilityHandlers } from "./markdown-renderer";
import { ExecutionTrace, executionRuns } from "./execution-trace";
import { ToolActivityList, toolActivity } from "./tool-activity";
import { PlanCard, planFor } from "./plan-card";

function messageFiles(message: UIMessage): Array<{ filename?: string; mediaType?: string }> {
  return message.parts.filter((part) => part.type === "file").map((part) => part as unknown as { filename?: string; mediaType?: string });
}

type Props = {
  message: UIMessage;
  streaming: boolean;
  /** Only the final response carries the brand mark under its action bar. */
  last: boolean;
  theme: "dark" | "light";
  chatFont: "serif" | "sans";
  haptics: boolean;
  voiceLanguage: string;
  rating?: "up" | "down";
  onRate?: (value: "up" | "down") => void;
  onRetry?: () => void;
  onLongPress?: (message: { id: string; text: string; role: string }) => void;
  capabilities?: CapabilityHandlers;
};

export function MessageRow({ message, streaming, last, theme, chatFont, haptics, voiceLanguage, rating, onRate, onRetry, onLongPress, capabilities }: Props) {
  const text = messageText(message);
  const files = messageFiles(message);
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    haptic("success", haptics);
    window.setTimeout(() => setCopied(false), 1_300);
  }

  function readAloud() {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    haptic("selection", haptics);
    setSpeaking(true);
    const language = voiceLanguage === "auto" ? navigator.language || "en-US" : voiceLanguage;
    whenVoicesReady(() => speak(text, language));
    // speechSynthesis has no reliable end event across engines; poll it.
    const poll = window.setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        window.clearInterval(poll);
        setSpeaking(false);
      }
    }, 400);
  }

  function rate(value: "up" | "down") {
    haptic(value === "up" ? "success" : "selection", haptics);
    onRate?.(value);
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
      className={`navi-message-enter flex ${user ? "justify-end" : "justify-start"}`}
    >
      {user ? (
        <div className="max-w-[85%] rounded-[18px] bg-[var(--bg-bubble-user)] px-4 py-2.5 text-[1rem]/[1.5rem] font-normal text-primary">
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
          <ToolActivityList
            activities={toolActivity(message).filter((activity) => activity.name !== "run_javascript")}
            haptics={haptics}
          />
          <ExecutionTrace runs={executionRuns(message)} haptics={haptics} />
          <div className={`navi-markdown text-[1rem]/[1.625rem] font-normal ${chatFont === "serif" ? "navi-chat-serif" : ""} ${streaming ? "streaming-cursor" : ""}`}>
            {text ? <MarkdownRenderer text={text} theme={theme} haptics={haptics} capabilities={capabilities} /> : null}
          </div>
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
              {last ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/brand-spark.png" alt="" aria-hidden="true" className="ml-2.5 mt-1 h-[14px] w-[14px] opacity-70" />
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}
