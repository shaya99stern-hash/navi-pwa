"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

/**
 * Reasoning stays available, but it should never compete with the answer.
 * The old full-width card added a second visual "message" before every reply.
 * Keep the disclosure deliberately quiet and compact; expanded details remain
 * available for people who actually want them.
 */
export function ReasoningDisclosure({
  text,
  streaming = false
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="navi-reasoning my-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-1.5 py-0.5 text-left text-tertiary transition-colors active:bg-elev-2"
      >
        <Brain size={13} strokeWidth={1.7} className="shrink-0" />
        <span className="min-w-0 truncate text-[11px]/4 font-medium">
          {streaming ? "Thinking…" : "Thought about this"}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="ml-2 mt-1 max-w-[42rem] border-l border-[var(--border-subtle)] pl-3 pr-2 text-[12px]/5 text-secondary">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A persisted message can remember that reasoning happened without retaining
 * the private reasoning text. Use the same low-noise footprint as the live
 * disclosure instead of recreating a large empty card after reload.
 */
export function ReasoningTrace() {
  return (
    <div
      className="navi-reasoning-trace my-1.5 inline-flex min-h-7 items-center gap-1.5 px-1.5 py-0.5 text-tertiary"
      title="Reasoning was used for this response; the private notes are not retained."
    >
      <Brain size={13} strokeWidth={1.7} className="shrink-0" />
      <span className="text-[11px]/4 font-medium">Thought about this</span>
    </div>
  );
}
