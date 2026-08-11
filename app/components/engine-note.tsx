"use client";

import type { UIMessage } from "ai";
import type { NaviEngineNote } from "@/lib/ai/types";

/**
 * Which engine answered, under the answer.
 *
 * The app routes across a dozen models by difficulty, attachment, tool need and
 * provider health, and told the reader none of it. Every reply looked the same
 * whether it came from the fast lane or the strongest one — so moving the
 * effort dial appeared to change nothing, a reply recovered from a failed route
 * was indistinguishable from a first-choice one, and the owner watching the app
 * fail could not see that three engines had been tried. Claude puts its model
 * in the composer; this is the same information in the place it belongs, which
 * is next to the specific answer it produced rather than next to the next one.
 *
 * Quiet by construction. It sits with the copy and rating controls at the foot
 * of a reply, in the tertiary colour, and never names a provider — `engineName`
 * maps a route to what it is *for*, which is both the house rule and the more
 * durable label.
 */

type EnginePart = { type: string; data?: unknown };

export function engineNoteFor(message: UIMessage): NaviEngineNote | null {
  const parts = message.parts as unknown as EnginePart[];
  /* The last one wins. A turn that failed over writes a note per attempt, and
     the engine that actually answered is the one that wrote last. */
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
  /* "Navi Deep · Extended" — engine, then how hard it was asked to work. The
     separator is a middle dot rather than a slash or a dash because both of
     those already mean something in this app's copy. */
  const label = note.effort ? `${note.engine} · ${note.effort}` : note.engine;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[0.6875rem]/[0.875rem] font-medium text-tertiary"
      /* The visible text is already the whole content, so the title carries the
         part that is not obvious: why this reply came from where it did. */
      title={note.recovered ? "An earlier engine did not respond, so this one answered instead." : undefined}
    >
      {label}
      {note.recovered ? <span className="text-tertiary opacity-80">· recovered</span> : null}
    </span>
  );
}
