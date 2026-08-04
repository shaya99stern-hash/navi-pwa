"use client";

import { Check, ChevronDown, TerminalSquare, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { UIMessage } from "ai";
import { haptic } from "@/lib/ui/haptics";

/**
 * What actually ran, and what it said.
 *
 * The point of running code is not only the accuracy it buys — it is that the
 * user can see it happened. "Ran, failed, fixed, ran" is the difference between
 * an assistant asserting an algorithm works and one that checked. Collapsed by
 * default, because most of the time the answer is the interesting part; open it
 * and the failures are all there, including the ones that got repaired.
 */

type Run = {
  id: string;
  code: string;
  purpose: string;
  output: string;
  failed: boolean;
  pending: boolean;
};

type RunPart = { type: string; toolCallId?: string; input?: unknown; output?: unknown };

export function executionRuns(message: UIMessage): Run[] {
  /* Cast rather than narrow: the SDK types message parts as a union keyed by
     the tools declared to the client, and this tool is declared server-side
     with no `execute` — so it exists at runtime and not in that union. */
  const parts = message.parts as unknown as RunPart[];
  return parts.filter((part) => part?.type === "tool-run_javascript").map((part, index) => {
    const input = (part.input ?? {}) as { code?: string; purpose?: string };
    const output = typeof part.output === "string" ? part.output : "";
    return {
      id: part.toolCallId ?? `run-${index}`,
      code: typeof input.code === "string" ? input.code : "",
      purpose: typeof input.purpose === "string" ? input.purpose : "",
      output,
      /* The sandbox states the verdict in its first line, deliberately, so
         neither the model nor this component has to infer it from a stack
         trace that may or may not be present. */
      failed: output.startsWith("The code failed"),
      pending: !output
    };
  });
}

export function ExecutionTrace({ runs, haptics }: { runs: Run[]; haptics: boolean }) {
  const [open, setOpen] = useState(false);
  if (!runs.length) return null;

  const settled = runs.filter((run) => !run.pending);
  const running = runs.length - settled.length;
  const failures = settled.filter((run) => run.failed).length;
  const lastFailed = settled.length > 0 && settled[settled.length - 1].failed;

  /* The summary has to be honest about the *last* run, not the best one.
     Presenting code that failed its final attempt as working is the one
     outcome this whole feature exists to prevent. */
  const summary = running
    ? `Running code… (${settled.length + 1} of ${runs.length})`
    : lastFailed
      ? `Ran ${settled.length} time${settled.length === 1 ? "" : "s"} · still failing`
      : failures
        ? `Ran ${settled.length} times · fixed after ${failures} failure${failures === 1 ? "" : "s"}`
        : `Ran and checked${settled.length > 1 ? ` ${settled.length} times` : ""}`;

  return (
    <div className="my-3 overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-elev-2">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); haptic("impact-light", haptics); }}
        className="flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left active:bg-elev-3"
        aria-expanded={open}
      >
        {running ? (
          <TerminalSquare size={16} className="shrink-0 animate-pulse text-accent" />
        ) : lastFailed ? (
          <TriangleAlert size={16} className="shrink-0 text-danger" />
        ) : (
          <Check size={16} className="shrink-0 text-success" />
        )}
        <span className="min-w-0 flex-1 truncate text-[0.8125rem]/[1.125rem] font-medium text-secondary">{summary}</span>
        <ChevronDown size={16} className={`shrink-0 text-tertiary transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-[var(--border-subtle)]">
          {runs.map((run, index) => (
            <div key={run.id} className={index ? "border-t border-[var(--border-subtle)]" : ""}>
              <div className="flex items-center gap-2 px-3.5 pt-3">
                <span className="text-[0.6875rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">
                  Attempt {index + 1}
                </span>
                {run.pending ? null : (
                  <span className={`text-[0.6875rem]/4 font-semibold ${run.failed ? "text-danger" : "text-success"}`}>
                    {run.failed ? "failed" : "passed"}
                  </span>
                )}
                {run.purpose ? <span className="min-w-0 truncate text-[0.6875rem]/4 text-tertiary">{run.purpose}</span> : null}
              </div>
              {run.code ? (
                <pre className="mx-3.5 mt-2 overflow-x-auto rounded-xl bg-elev-3 p-3 text-[0.75rem]/[1.125rem] text-secondary">
                  <code>{run.code}</code>
                </pre>
              ) : null}
              <pre className="mx-3.5 my-3 overflow-x-auto whitespace-pre-wrap text-[0.75rem]/[1.125rem] text-tertiary">
                {run.pending ? "Running…" : run.output}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
