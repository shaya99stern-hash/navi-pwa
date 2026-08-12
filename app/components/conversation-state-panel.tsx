"use client";

import { Check, CircleStop, TriangleAlert } from "lucide-react";
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
  if (!generating && !status) return null;

  const stage = status?.stage ?? "gather";
  const stopped = stage === "interrupted";
  const failed = stage === "error";

  /* Completion, said rather than felt.
   *
   * `haptic("success")` used to run here and was skipped every single time:
   * both vibration mechanisms require transient user activation, and a reply
   * lands seconds after the tap that asked for it. The two events most worth
   * feeling were the two that never fired, and nothing said so.
   *
   * So completion is carried by the channels that need no activation. This is
   * the status line; the notification (only when backgrounded) is in the
   * shell's `onFinish`; and the motion is the line settling and fading out on
   * its own, which is why it collapses in CSS rather than on a timer here. */
  if (!generating && stage === "complete") {
    return (
      <div className="navi-status-settle flex items-center gap-2 px-1" role="status" aria-live="polite">
        <Check size={15} className="text-tertiary" />
        <span className="text-[0.8125rem]/[1.125rem] font-medium text-tertiary">{status?.detail || LABELS.complete}</span>
      </div>
    );
  }

  if (!generating) return null;

  if (failed || stopped) {
    const Icon = failed ? TriangleAlert : CircleStop;
    return (
      <div className="mt-3 flex items-center gap-2 px-1" role="status" aria-live="polite">
        <Icon size={15} className={failed ? "text-danger" : "text-tertiary"} />
        <span className={`text-[0.8125rem]/[1.125rem] font-medium ${failed ? "text-danger" : "text-tertiary"}`}>
          {status?.detail || LABELS[stage]}
        </span>
      </div>
    );
  }

  /* A tool announces its own work ("Searching for …", "Calculating …"), which
     is more use than a generic stage name, so prefer it when one arrives. */
  const announced = status?.detail?.endsWith("…") ? status.detail : null;
  const label = announced
    ?? `${research && (stage === "gather" || stage === "plan") ? "Researching" : LABELS[stage] || "Thinking"}…`;

  return (
    <div className="mt-3 flex items-center gap-2 px-1" role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-spark.png" alt="" aria-hidden="true" className="thinking-spark h-[18px] w-[18px]" />
      <span className="truncate text-[0.875rem]/5 font-medium text-tertiary">{label}</span>
    </div>
  );
}
