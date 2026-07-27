"use client";

import { Braces, FileText, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { InstallButton } from "./install-button";
import { NaviMark } from "./navi-mark";

const SUGGESTIONS = [
  {
    icon: FileText,
    title: "Plan something complex",
    detail: "Turn a project into clear steps, risks, and deliverables.",
    prompt: "Help me plan a complex project from start to finish. Ask only the questions that are necessary."
  },
  {
    icon: ImageIcon,
    title: "Create a polished image",
    detail: "Generate a real raster image instead of a placeholder artifact.",
    prompt: "Generate a polished, professional image for me."
  },
  {
    icon: Braces,
    title: "Build an interactive tool",
    detail: "Create a working calculator, form, dashboard, or mini app.",
    prompt: "Create a secure interactive tool for me and make every control work."
  }
] as const;

export function LaunchSurface({
  online,
  haptics,
  onPrompt
}: {
  online: boolean;
  haptics: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-5 pb-24 pt-7">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center">
        <div className="launch-brand mb-8 flex flex-col items-center text-center">
          <div className="brand-orb mb-5 flex h-[76px] w-[76px] items-center justify-center rounded-[28px] border border-[var(--border-subtle)] bg-elev-1 shadow-composer">
            <NaviMark className="h-12 w-12 text-accent" />
          </div>
          <div className="text-[12px]/4 font-semibold uppercase tracking-[0.18em] text-tertiary">Navi by NaviOS</div>
          <h1 className="hero-title mt-3 text-balance text-center text-[34px]/[38px] font-medium tracking-[-0.035em] text-primary sm:text-[40px]/[44px]">
            How can I help you today?
          </h1>
          <p className="mt-3 max-w-md text-balance text-center text-[14px]/[21px] font-medium text-secondary">
            A private AI workspace for conversations, files, images, tools, and long-running projects.
          </p>
        </div>

        <div className="grid gap-3">
          {SUGGESTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                type="button"
                disabled={!online}
                onClick={() => onPrompt(item.prompt)}
                className="suggestion-card group flex min-h-[82px] items-center gap-4 rounded-[22px] border border-[var(--border-subtle)] bg-elev-1 px-4 py-3 text-left shadow-sm transition-transform duration-150 active:scale-[0.985] active:bg-elev-2 disabled:opacity-50"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-elev-2 text-accent transition-transform duration-150 group-active:scale-95">
                  <Icon size={21} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]/[21px] font-semibold text-primary">{item.title}</span>
                  <span className="mt-0.5 block text-[12px]/[17px] font-medium text-tertiary">{item.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-elev-1 px-4 text-[12px]/4 font-semibold text-tertiary">
            <ShieldCheck size={16} className="text-success" />
            Local history · private server keys
          </div>
          <InstallButton haptics={haptics} />
        </div>
      </div>
    </div>
  );
}
