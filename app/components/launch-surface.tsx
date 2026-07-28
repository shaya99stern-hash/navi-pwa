"use client";

import { Braces, FileSearch, PenLine, Search, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import { InstallButton } from "./install-button";

const STARTERS = [
  {
    icon: PenLine,
    label: "Write",
    prompt: "Help me write something polished. Ask what format, audience, and tone I need."
  },
  {
    icon: Search,
    label: "Research",
    prompt: "Research this carefully, separate verified facts from inference, and cite the strongest available evidence."
  },
  {
    icon: FileSearch,
    label: "Analyze",
    prompt: "Help me analyze a file, document, screenshot, or problem in detail."
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
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-24 pt-6">
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <Image
          src="/pwa-icon-192-v4.png"
          alt="Navi"
          width={64}
          height={64}
          priority
          className="mb-5 rounded-[20px] shadow-card"
        />

        <h1 className="hero-title max-w-[430px] text-[35px]/[40px] font-medium tracking-[-0.035em] text-primary">
          How can I help you today?
        </h1>
        <p className="mt-3 max-w-[360px] text-[14px]/[21px] font-medium text-secondary">
          Ask anything, attach a file, or choose a place to start.
        </p>

        <button
          type="button"
          onClick={onOpenModels}
          className="mt-5 inline-flex min-h-10 max-w-[220px] items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-card px-3.5 text-[12px]/4 font-semibold text-secondary shadow-card active:bg-elev-2"
          aria-label={`Current model: ${activeModel}. Change model`}
        >
          <Sparkles size={15} className="shrink-0 text-accent" />
          <span className="truncate">{activeModel}</span>
        </button>

        <div className="mt-7 flex max-w-[390px] flex-wrap justify-center gap-2" aria-label="Conversation starters">
          {STARTERS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                disabled={!online}
                onClick={() => onPrompt(item.prompt)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-card px-3.5 text-[12px]/4 font-semibold text-primary shadow-card active:bg-elev-2 disabled:opacity-50"
              >
                <Icon size={15} className="text-accent" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <div className="inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-[11px]/4 font-semibold text-tertiary">
            <ShieldCheck size={15} className="text-success" />
            Private by default
          </div>
          <InstallButton haptics={haptics} />
        </div>
      </div>
    </div>
  );
}
