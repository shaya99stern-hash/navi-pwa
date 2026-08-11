"use client";

import { Check, ChevronDown, CircleSlash, Globe, Search, TerminalSquare, Wrench } from "lucide-react";
import { useState } from "react";
import type { UIMessage } from "ai";
import { haptic } from "@/lib/ui/haptics";

/**
 * What Navi Soul did, as a line of plain English.
 *
 * Tool activity used to surface as raw structured output — the argument object
 * and the result blob, rendered into the conversation. That reads as a debug
 * log rather than as an assistant working, and it is a large part of why the
 * app felt unfinished even when the underlying calls succeeded.
 *
 * So: a chip. One line, a verb, collapsed. Tap it and the query and a summary
 * of what came back are there. The JSON is never the default state.
 *
 * A failed call is a *neutral* chip, not a red error. The model carries on
 * without that tool and usually still answers; presenting a recoverable gap as
 * a failure teaches the user to distrust a response that is fine.
 */

export type ToolActivity = {
  id: string;
  /** The tool's registered name, e.g. `web_search`. */
  name: string;
  input: Record<string, unknown>;
  output: string;
  state: "running" | "done" | "failed";
};

/** Present tense while it runs, past tense once it has. */
type Verbs = { running: string; done: string; icon: "search" | "code" | "repo" | "fetch" | "generic" };

const VERBS: Array<{ match: RegExp; verbs: Verbs }> = [
  { match: /^web_search$|search/i, verbs: { running: "Searching the web", done: "Searched the web", icon: "search" } },
  { match: /^web_fetch$|fetch|read_url/i, verbs: { running: "Reading a page", done: "Read a page", icon: "fetch" } },
  { match: /^run_javascript$|execute|code/i, verbs: { running: "Running code", done: "Ran code", icon: "code" } },
  { match: /^github_(read|list|search)|repo/i, verbs: { running: "Reading the repository", done: "Read the repository", icon: "repo" } },
  { match: /^github_(write|commit|branch|pull)/i, verbs: { running: "Opening a pull request", done: "Opened a pull request", icon: "repo" } },
  { match: /^skill_|playbook/i, verbs: { running: "Applying a playbook", done: "Applied a playbook", icon: "generic" } }
];

const FALLBACK: Verbs = { running: "Working", done: "Checked", icon: "generic" };

export function verbsFor(name: string): Verbs {
  return VERBS.find((entry) => entry.match.test(name))?.verbs ?? FALLBACK;
}

/**
 * A short note on what came back, for the collapsed line.
 *
 * Counted rather than quoted: "4 sources" tells the reader what they need to
 * know about a search, and the titles would not fit on a phone anyway.
 */
export function summarise(activity: ToolActivity): string {
  if (activity.state === "running") return "";
  if (activity.state === "failed") return "";
  const urls = activity.output.match(/https?:\/\/\S+/g);
  if (urls?.length) {
    const unique = new Set(urls.map((url) => url.replace(/[),.]+$/, "")));
    return `${unique.size} source${unique.size === 1 ? "" : "s"}`;
  }
  if (/^The code (ran successfully|failed)/.test(activity.output)) return "";
  const lines = activity.output.trim().split("\n").filter(Boolean).length;
  return lines > 1 ? `${lines} lines` : "";
}

/**
 * A failure that the model routed around is not an error the user must act on.
 * It says the capability was unavailable and stops there.
 */
function failedLabel(name: string): string {
  const verbs = verbsFor(name);
  if (verbs.icon === "search") return "Search unavailable";
  if (verbs.icon === "code") return "Code execution unavailable";
  if (verbs.icon === "repo") return "Repository unavailable";
  return "Tool unavailable";
}

function Icon({ kind, running }: { kind: Verbs["icon"]; running: boolean }) {
  const className = `shrink-0 ${running ? "animate-pulse text-accent" : "text-tertiary"}`;
  if (kind === "search") return <Search size={15} className={className} />;
  if (kind === "fetch") return <Globe size={15} className={className} />;
  if (kind === "code") return <TerminalSquare size={15} className={className} />;
  if (kind === "repo") return <Wrench size={15} className={className} />;
  return <Wrench size={15} className={className} />;
}

type ActivityPart = { type: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown; errorText?: unknown };

/**
 * Read tool activity off a message.
 *
 * Cast rather than narrowed: the SDK types message parts as a union keyed by
 * the tools declared to the *client*, and most of these are declared on the
 * server — so they exist at runtime and not in that union.
 */
export function toolActivity(message: UIMessage): ToolActivity[] {
  const parts = message.parts as unknown as ActivityPart[];
  return parts
    .filter((part) => typeof part?.type === "string" && part.type.startsWith("tool-"))
    .map((part, index) => {
      const name = part.type.slice("tool-".length);
      const output = typeof part.output === "string"
        ? part.output
        : part.output === undefined ? "" : JSON.stringify(part.output);
      const failed = Boolean(part.errorText)
        || part.state === "output-error"
        || /^The code failed/.test(output);
      return {
        id: part.toolCallId ?? `${name}-${index}`,
        name,
        input: (part.input ?? {}) as Record<string, unknown>,
        output,
        state: part.output === undefined && !part.errorText ? "running" : failed ? "failed" : "done"
      } satisfies ToolActivity;
    });
}

function Chip({ activity, haptics }: { activity: ToolActivity; haptics: boolean }) {
  const [open, setOpen] = useState(false);
  const verbs = verbsFor(activity.name);
  const running = activity.state === "running";
  const summary = summarise(activity);

  const label = activity.state === "failed"
    ? failedLabel(activity.name)
    : running ? verbs.running : summary ? `${verbs.done} · ${summary}` : verbs.done;

  /* The first string field of the input is the query, the path, or the URL —
     whatever the user would recognise. Never the whole object. */
  const detail = Object.values(activity.input).find((value) => typeof value === "string" && value.trim());

  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-elev-2">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); haptic("impact-light", haptics); }}
        className="flex min-h-10 w-full items-center gap-2 px-3 text-left active:bg-elev-3"
        aria-expanded={open}
      >
        {activity.state === "failed"
          ? <CircleSlash size={15} className="shrink-0 text-tertiary" />
          : activity.state === "done"
            ? <Check size={15} className="shrink-0 text-success" />
            : <Icon kind={verbs.icon} running />}
        <span className="min-w-0 flex-1 truncate text-[0.8125rem]/[1.125rem] font-medium text-secondary">{label}</span>
        <ChevronDown size={15} className={`shrink-0 text-tertiary transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          {typeof detail === "string" ? (
            <p className="mb-1.5 break-words text-[0.75rem]/[1.125rem] text-secondary">{detail}</p>
          ) : null}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[0.75rem]/[1.125rem] text-tertiary">
            {running ? "Working…" : activity.output || "Nothing came back."}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** Chips stack in call order, so the sequence reads as the work that happened. */
export function ToolActivityList({ activities, haptics }: { activities: ToolActivity[]; haptics: boolean }) {
  if (!activities.length) return null;
  return (
    <div className="my-3 flex flex-col gap-1.5">
      {activities.map((activity) => <Chip key={activity.id} activity={activity} haptics={haptics} />)}
    </div>
  );
}
