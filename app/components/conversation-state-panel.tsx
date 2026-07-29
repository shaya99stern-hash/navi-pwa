"use client";

import { CircleStop, TriangleAlert } from "lucide-react";
import type { NaviStreamStatus } from "@/lib/ai/types";

const LABELS: Partial<Record<NaviStreamStatus["stage"], string>> = {
  gather: "Thinking",
  plan: "Thinking",
  draft: "Working",
  synthesize: "Working",
  verify: "Checking",
  stream: "Writing",
  complete: "Done",
  interrupted: "Stopped",
  error: "Something went wrong"
};

type Props = {
  research: boolean;
  generating: boolean;
  status: NaviStreamStatus | null;
};

export function ConversationStatePanel({ research, generating, status }: Props) {
  if (!generating && (!status || status.stage === "complete")) return null;

  const stage = status?.stage ?? "gather";
  const stopped = stage === "interrupted";
  const failed = stage === "error";

  if (failed || stopped) {
    const Icon = failed ? TriangleAlert : CircleStop;
    return (
      <div className="mt-3 flex items-center gap-2 px-1" role="status" aria-live="polite">
        <Icon size={15} className={failed ? "text-danger" : "text-tertiary"} />
        <span className={`text-[13px]/[18px] font-medium ${failed ? "text-danger" : "text-tertiary"}`}>
          {status?.detail || LABELS[stage]}
        </span>
      </div>
    );
  }

  const label = research && (stage === "gather" || stage === "plan")
    ? "Researching"
    : LABELS[stage] || "Thinking";

  return (
    <div className="mt-3 flex items-center gap-2 px-1" role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-spark.png" alt="" aria-hidden="true" className="thinking-spark h-[18px] w-[18px]" />
      <span className="text-[14px]/5 font-medium text-tertiary">{label}…</span>
    </div>
  );
}
