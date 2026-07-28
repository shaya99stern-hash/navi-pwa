"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import { InstallButton } from "./install-button";

export function LaunchSurface({
  online,
  haptics,
  activeModel,
  onOpenModels,
  onOpenPrivacy
}: {
  online: boolean;
  haptics: boolean;
  activeModel: string;
  onOpenModels: () => void;
  onOpenPrivacy: () => void;
}) {
  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-24 pt-3">
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col items-center text-center">
        <div className="flex w-full items-center justify-center gap-2">
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex min-h-9 max-w-[220px] items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-elev-1)_86%,transparent)] px-3 text-[11px]/4 font-semibold text-secondary active:bg-elev-2"
            aria-label={`Navi mode: ${activeModel}. Change model or response profile`}
          >
            <Sparkles size={14} className="shrink-0 text-accent" />
            <span className="truncate">{activeModel}</span>
          </button>
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-elev-1)_86%,transparent)] text-secondary active:bg-elev-2"
            aria-label="Open privacy and local history controls"
          >
            <ShieldCheck size={15} />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center pb-10">
          <Image
            src="/pwa-icon-192-v4.png"
            alt="Navi"
            width={44}
            height={44}
            priority
            className="mb-5 rounded-[15px] shadow-card"
          />

          <h1 className="hero-title max-w-[430px] text-[34px]/[39px] font-medium tracking-[-0.04em] text-primary">
            How can I help you today?
          </h1>
          <p className="mt-3 max-w-[320px] text-[13px]/5 font-medium text-secondary">
            Ask, attach, or speak. Your local workspace stays on this device.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-1.5">
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px]/4 font-semibold text-tertiary">
              <ShieldCheck size={14} className="text-success" />
              {online ? "Ready" : "Offline drafts saved"}
            </span>
            <InstallButton haptics={haptics} />
          </div>
        </div>
      </div>
    </div>
  );
}
