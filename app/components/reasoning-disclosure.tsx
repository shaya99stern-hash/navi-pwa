"use client";

import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { UIMessage } from "ai";
import { haptic } from "@/lib/ui/haptics";

/**
 * The thinking, shown while it happens.
 *
 * Extended thinking was being done and never seen, which is most of why
 * "thinking harder" felt like it changed nothing: the user waited longer and
 * got a similar-looking answer, with no evidence the extra time bought
 * anything.
 *
 * ## Live, but not replayed
 *
 * Reasoning traces are provider-specific and not portable. An assistant turn
 * recorded with one provider's `reasoning_content` is rejected outright by
 * providers that do not accept the field, which turns a single reasoning reply
 * into a permanently broken conversation — and lane fallback makes that
 * certain rather than unlikely, since turn two may go somewhere turn one did
 * not.
 *
 * So the text streams to the screen and is stripped from what goes back to any
 * model. After a reload the trace is gone; what survives is the fact that
 * there was one, which is enough for the disclosure to keep its place rather
 * than silently disappearing from a conversation the user remembers.
 */

type ReasoningPart = { type: string; text?: unknown };

export function reasoningFor(message: UIMessage): string {
  const parts = message.parts as unknown as ReasoningPart[];
  return parts
    .filter((part) => part?.type === "reasoning" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

/**
 * Whether this turn had reasoning, independent of whether the text survived.
 *
 * Persisted with the conversation so a reloaded thread still shows that the
 * work happened. Without it, reopening a chat quietly removes a disclosure the
 * user watched appear, which reads as the app losing something.
 */
export function hadReasoning(message: UIMessage): boolean {
  const parts = message.parts as unknown as ReasoningPart[];
  return parts.some((part) => part?.type === "reasoning")
    || Boolean((message as unknown as { metadata?: { reasoned?: boolean } }).metadata?.reasoned);
}

export function ReasoningDisclosure({ text, streaming, haptics }: {
  text: string;
  streaming: boolean;
  haptics: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <div className="navi-reasoning-disclosure my-1.5 w-fit max-w-full">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); haptic("impact-light", haptics); }}
        className="flex min-h-7 items-center gap-1.5 rounded-full px-2 text-left text-tertiary transition-colors active:bg-elev-2"
        aria-expanded={open}
      >
        <Brain size={13} className={`shrink-0 ${streaming ? "animate-pulse text-accent" : "text-tertiary"}`} />
        <span className="min-w-0 truncate text-[0.6875rem]/4 font-medium">
          {streaming ? "Thinking…" : "Thought about this"}
        </span>
        <ChevronDown size={12} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="mt-1 max-w-[min(32rem,calc(100vw-3rem))] rounded-[14px] border border-[var(--border-subtle)] bg-elev-1 px-3 py-2.5">
          <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[0.72rem]/[1.18rem] text-tertiary">{text}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Shown when a reloaded turn is known to have reasoned but no longer has it. */
export function ReasoningTrace() {
  return (
    <div className="navi-reasoning-disclosure my-1.5 flex min-h-7 w-fit items-center gap-1.5 rounded-full px-2 text-tertiary">
      <Brain size={13} className="shrink-0" />
      <span className="text-[0.6875rem]/4 font-medium">
        Thought about this — the notes are not kept
      </span>
    </div>
  );
}
