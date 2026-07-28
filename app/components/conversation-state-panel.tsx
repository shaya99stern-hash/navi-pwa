"use client";

import { CheckCircle2, CircleStop, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import type { NaviStreamStatus } from "@/lib/ai/types";

const STAGES: NaviStreamStatus["stage"][] = ["gather", "plan", "draft", "synthesize", "verify", "stream"];

const LABELS: Partial<Record<NaviStreamStatus["stage"], string>> = {
  gather: "Gathering context",
  plan: "Planning the response",
  draft: "Drafting",
  synthesize: "Combining results",
  verify: "Checking the answer",
  stream: "Writing the response",
  complete: "Response complete",
  interrupted: "Response stopped",
  error: "Response failed"
};

type Props = {
  research: boolean;
  generating: boolean;
  status: NaviStreamStatus | null;
};

export function ConversationStatePanel({ research, generating, status }: Props) {
  if (!generating && (!status || status.stage === "complete")) return null;

  const stage = status?.stage ?? "gather";
  const currentIndex = Math.max(0, STAGES.indexOf(stage));
  const stopped = stage === "interrupted";
  const failed = stage === "error";
  const title = failed
    ? "Navi could not finish"
    : stopped
      ? "Generation stopped"
      : research
        ? "Research in progress"
        : "Navi is working";

  const Icon = failed ? TriangleAlert : stopped ? CircleStop : research ? Search : LoaderCircle;
  const tone = failed
    ? "border-[var(--accent-danger)] text-danger"
    : research
      ? "border-accent bg-[var(--selection-bg)] text-accent"
      : "border-[var(--border-subtle)] bg-elev-2 text-secondary";

  return (
    <div className={`mt-4 rounded-[20px] border p-3 ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elev-1">
          <Icon size={17} className={!failed && !stopped && generating ? "animate-pulse" : ""} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]/[18px] font-semibold text-primary">{title}</span>
          <span className="mt-0.5 block text-[12px]/4 font-medium text-secondary">
            {status?.detail || LABELS[stage] || "Preparing your request."}
          </span>
        </span>
      </div>

      {!failed && !stopped && generating ? (
        <div className="mt-3 grid grid-cols-6 gap-1" aria-label={`Current phase: ${LABELS[stage] || stage}`}>
          {STAGES.map((item, index) => {
            const complete = index < currentIndex;
            const active = index === currentIndex;
            return (
              <span
                key={item}
                title={LABELS[item]}
                className={`h-1.5 rounded-full transition-colors duration-200 ${complete || active ? "bg-accent" : "bg-elev-3"}`}
              >
                {complete ? <CheckCircle2 className="sr-only" /> : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {research && generating ? (
        <p className="mt-2 text-[10px]/4 font-medium text-tertiary">
          Web and connected-source access are used only when the active provider actually supports them.
        </p>
      ) : null}
    </div>
  );
}
