"use client";

import { Check, Circle, ListChecks } from "lucide-react";
import type { UIMessage } from "ai";

/**
 * The plan, before the work.
 *
 * Navi Soul has been making plans for a while — deciding what a good answer looks
 * like, and what it has to satisfy — but the plan lived entirely inside the
 * request. The user saw a one-line status and then a finished answer, which
 * means the only moment they could correct a misread of their intent was after
 * the work was already done.
 *
 * Showing it costs nothing and moves that moment earlier. Correcting a plan is
 * far cheaper than correcting an answer, for the person and for the budget.
 */

export type PlanStep = { text: string; done: boolean };

export type PlanPayload = {
  summary: string;
  steps: PlanStep[];
};

type PlanPart = { type: string; data?: unknown };

/**
 * Read the plan off a message.
 *
 * Cast rather than narrowed: the SDK types data parts by the schema the client
 * declares, and this one is emitted by the route.
 */
export function planFor(message: UIMessage): PlanPayload | null {
  const parts = message.parts as unknown as PlanPart[];
  const part = parts.find((entry) => entry?.type === "data-plan");
  if (!part?.data || typeof part.data !== "object") return null;

  const data = part.data as { summary?: unknown; steps?: unknown };
  const steps = Array.isArray(data.steps)
    ? data.steps
      .map((step) => (typeof step === "string"
        ? { text: step, done: false }
        : { text: String((step as { text?: unknown })?.text ?? ""), done: Boolean((step as { done?: unknown })?.done) }))
      .filter((step) => step.text.trim())
    : [];

  if (!steps.length) return null;
  return { summary: typeof data.summary === "string" ? data.summary : "", steps };
}

export function PlanCard({ plan }: { plan: PlanPayload }) {
  const done = plan.steps.filter((step) => step.done).length;

  return (
    <div className="my-3 overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-elev-2">
      <div className="flex min-h-10 items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5">
        <ListChecks size={15} className="shrink-0 text-tertiary" />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem]/[1.125rem] font-medium text-secondary">
          {plan.summary || "Plan"}
        </span>
        {/* Only once something is actually finished — "0 of 4" on a plan that
            has not started reads as a stall rather than as progress. */}
        {done > 0 ? (
          <span className="shrink-0 text-[0.6875rem]/4 font-semibold text-tertiary">{done} of {plan.steps.length}</span>
        ) : null}
      </div>

      <ol className="flex flex-col gap-1.5 px-3.5 py-2.5">
        {plan.steps.map((step, index) => (
          <li key={`${index}-${step.text}`} className="flex items-start gap-2">
            {step.done
              ? <Check size={14} className="mt-0.5 shrink-0 text-success" />
              : <Circle size={14} className="mt-0.5 shrink-0 text-tertiary" />}
            <span className={`min-w-0 text-[0.8125rem]/[1.25rem] ${step.done ? "text-tertiary line-through" : "text-secondary"}`}>
              {step.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
