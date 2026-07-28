"use client";

import {
  Beaker,
  Braces,
  FileSearch,
  Image as ImageIcon,
  PenLine,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { InstallButton } from "./install-button";
import { NaviMark } from "./navi-mark";

const CAPABILITIES = [
  {
    icon: PenLine,
    label: "Write",
    prompt: "Help me write something polished. Ask what format, audience, and tone I need."
  },
  {
    icon: Beaker,
    label: "Research",
    prompt: "Research this carefully, separate verified facts from inference, and cite the strongest available evidence."
  },
  {
    icon: FileSearch,
    label: "Analyze",
    prompt: "Help me analyze a file, document, screenshot, or problem in detail."
  },
  {
    icon: ImageIcon,
    label: "Design",
    prompt: "Help me create or critique a polished visual design."
  },
  {
    icon: Braces,
    label: "Create",
    prompt: "Create a secure interactive artifact with working controls."
  }
] as const;

export function LaunchSurface({
  online,
  haptics,
  activeModel,
  onPrompt,
  onOpenModels
}: {
  online: boolean;
  haptics: boolean;
  activeModel: string;
  onPrompt: (prompt: string) => void;
  onOpenModels: () => void;
}) {
  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-20 pt-5">
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col justify-center">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-orb flex h-12 w-12 shrink-0 items-center justify-center rounded-[17px] border border-[var(--border-subtle)] bg-card shadow-card">
              <NaviMark className="h-8 w-8 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px]/4 font-semibold uppercase tracking-[0.16em] text-tertiary">Navi by NaviOS</div>
              <div className="truncate text-[15px]/5 font-semibold text-primary">Private AI workspace</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex min-h-11 max-w-[156px] items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-card px-3 text-[12px]/4 font-semibold text-secondary shadow-card active:bg-elev-2"
            aria-label={`Current model: ${activeModel}. Change model`}
          >
            <Sparkles size={15} className="shrink-0 text-accent" />
            <span className="truncate">{activeModel}</span>
          </button>
        </div>

        <div className="mb-8">
          <h1 className="hero-title max-w-[420px] text-[36px]/[40px] font-medium tracking-[-0.04em] text-primary">
            How can I help you today?
          </h1>
          <p className="mt-3 max-w-[420px] text-[14px]/[21px] font-medium text-secondary">
            Start with a message, attach something, or choose a capability below.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5" aria-label="Start a new conversation">
          {CAPABILITIES.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                disabled={!online}
                onClick={() => onPrompt(item.prompt)}
                className={`suggestion-card group flex min-h-[74px] items-center gap-3 border border-[var(--border-subtle)] bg-card px-3.5 py-3 text-left transition-transform duration-150 active:scale-[0.985] active:bg-elev-2 disabled:opacity-50 ${index === CAPABILITIES.length - 1 ? "col-span-2" : ""}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-elev-2 text-accent transition-transform duration-150 group-active:scale-95">
                  <Icon size={19} strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px]/5 font-semibold text-primary">{item.label}</span>
                  <span className="block text-[11px]/4 font-medium text-tertiary">
                    {item.label === "Write" && "Draft and refine"}
                    {item.label === "Research" && "Investigate with evidence"}
                    {item.label === "Analyze" && "Files, images, and problems"}
                    {item.label === "Design" && "Visuals and critique"}
                    {item.label === "Create" && "Interactive tools and artifacts"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-card px-4 text-[12px]/4 font-semibold text-tertiary shadow-card">
            <ShieldCheck size={16} className="text-success" />
            Local history · private server keys
          </div>
          <InstallButton haptics={haptics} />
        </div>
      </div>
    </div>
  );
}
