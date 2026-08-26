"use client";

import type { UIMessage } from "ai";
import type { NaviEngineNote } from "@/lib/ai/types";

/** Quiet per-reply routing metadata. Hidden on compact mobile chat by CSS. */
type EnginePart = { type: string; data?: unknown };

export function engineNoteFor(message: UIMessage): NaviEngineNote | null {
  const parts = message.parts as unknown as EnginePart[];
  const part = [...parts].reverse().find((entry) => entry?.type === "data-engine");
  if (!part?.data || typeof part.data !== "object") return null;

  const data = part.data as { engine?: unknown; effort?: unknown; recovered?: unknown };
  const engine = typeof data.engine === "string" ? data.engine.trim() : "";
  if (!engine) return null;
  return {
    engine,
    effort: typeof data.effort === "string" ? data.effort : "",
    recovered: Boolean(data.recovered)
  };
}

export function EngineNote({ note }: { note: NaviEngineNote }) {
  const label = note.effort ? `${note.engine} · ${note.effort}` : note.engine;

  return (
    <span
      className="navi-engine-note inline-flex items-center gap-1.5 text-[0.6875rem]/[0.875rem] font-medium text-tertiary"
      title={note.recovered ? "An earlier engine did not respond, so this one answered instead." : undefined}
    >
      {label}
      {note.recovered ? <span className="text-tertiary opacity-80">· recovered</span> : null}
    </span>
  );
}
