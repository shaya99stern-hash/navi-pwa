"use client";

import { Check, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Playbook } from "@/lib/playbooks";
import { haptic } from "@/lib/ui/haptics";

/**
 * A capability Navi has drafted, offered for installation.
 *
 * Installing one changes how the app answers every future request that matches
 * it, and the text comes from a model — which may have written it from a web
 * page it just read. That is a persistent behaviour change proposed by
 * untrusted content, so it never installs itself. The tap is the boundary.
 *
 * The instructions are shown in full before the tap rather than behind a
 * disclosure, because "add this capability" is not a decision anyone can make
 * from a title alone.
 */

type Props = {
  playbook: Omit<Playbook, "source">;
  installed: boolean;
  haptics: boolean;
  onInstall: (playbook: Omit<Playbook, "source">) => void;
  onRemove: (id: string) => void;
};

export function CapabilityCard({ playbook, installed, haptics, onInstall, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const preview = playbook.instructions.length > 420 && !expanded
    ? `${playbook.instructions.slice(0, 420).trimEnd()}…`
    : playbook.instructions;

  return (
    <figure className="my-4 overflow-hidden rounded-[22px] border border-[var(--border-subtle)] bg-elev-2 shadow-sm">
      <div className="flex min-h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <Sparkles size={17} className="shrink-0 text-accent" />
        <figcaption className="min-w-0 flex-1 truncate text-[0.875rem]/5 font-semibold text-primary">
          {playbook.name}
        </figcaption>
        <span className="shrink-0 text-[0.625rem]/3 font-semibold uppercase tracking-[0.1em] text-tertiary">
          {installed ? "Installed" : "Capability"}
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[0.8125rem]/[1.25rem] text-secondary">{playbook.description}</p>
        <pre className="mt-3 max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-elev-1 p-3 text-[0.75rem]/[1.125rem] text-tertiary">
          {preview}
        </pre>
        {playbook.instructions.length > 420 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-2 min-h-9 text-[0.8125rem]/5 font-medium text-accent"
          >
            {expanded ? "Show less" : "Show all"}
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
        {installed ? (
          <>
            <span className="flex flex-1 items-center gap-1.5 px-1 text-[0.8125rem]/5 font-medium text-accent">
              <Check size={15} strokeWidth={2.4} />
              NaviSol will use this automatically
            </span>
            <button
              type="button"
              onClick={() => { haptic("impact-light", haptics); onRemove(playbook.id); }}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.8125rem]/5 font-medium text-danger active:bg-elev-3"
            >
              <Trash2 size={15} strokeWidth={1.9} />
              Remove
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 px-1 text-[0.75rem]/4 text-tertiary">
              Saved on this device. Applied when a request matches.
            </span>
            <button
              type="button"
              onClick={() => { haptic("impact-medium", haptics); onInstall(playbook); }}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[0.875rem]/5 font-semibold text-white active:bg-accent-pressed"
            >
              Add capability
            </button>
          </>
        )}
      </div>
    </figure>
  );
}
