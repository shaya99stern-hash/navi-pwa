"use client";

import { AudioLines, Download, Music, Volume2 } from "lucide-react";
import { useMemo } from "react";
import type { GeneratedAudioPayload } from "@/lib/ai/audio-generation";
import { haptic } from "@/lib/ui/haptics";

function extensionFor(mimeType: GeneratedAudioPayload["mimeType"]): string {
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/flac") return "flac";
  if (mimeType === "audio/ogg") return "ogg";
  return "wav";
}

function safeFileName(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "navi-audio";
  return `${base}.${extension}`;
}

const KIND_ICON = {
  music: Music,
  effect: AudioLines,
  speech: Volume2
} as const;

const KIND_LABEL = {
  music: "Music",
  effect: "Sound cue",
  speech: "Voice"
} as const;

export function GeneratedAudioCard({ payload, haptics }: { payload: GeneratedAudioPayload; haptics: boolean }) {
  const dataUrl = useMemo(() => `data:${payload.mimeType};base64,${payload.data}`, [payload.data, payload.mimeType]);
  const fileName = safeFileName(payload.title, extensionFor(payload.mimeType));
  const Icon = KIND_ICON[payload.kind];

  return (
    <figure className="my-4 overflow-hidden rounded-[22px] border border-[var(--border-subtle)] bg-elev-2 shadow-sm">
      <div className="flex min-h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <Icon size={17} className="shrink-0 text-accent" />
        <figcaption className="min-w-0 flex-1 truncate text-[0.875rem]/5 font-semibold text-primary">{payload.title}</figcaption>
        {/* Navi's own name for the engine, never the raw model id. */}
        <span className="shrink-0 text-[0.625rem]/3 font-semibold uppercase tracking-[0.1em] text-tertiary">{payload.engine}</span>
      </div>

      <div className="px-4 py-3">
        {/* The platform player is deliberate: it already has scrubbing, volume,
            and background playback wired to the system, and on iOS it is the
            control people expect for a clip. */}
        <audio src={dataUrl} controls preload="metadata" className="w-full" />
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-2">
        <span className="flex-1 truncate text-[0.75rem]/4 text-tertiary">
          {KIND_LABEL[payload.kind]}
          {payload.durationSeconds ? ` · ${payload.durationSeconds}s` : ""}
        </span>
        <a
          href={dataUrl}
          download={fileName}
          onClick={() => haptic("selection", haptics)}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[0.8125rem]/5 font-medium text-primary active:bg-elev-1"
        >
          <Download size={15} strokeWidth={1.9} />
          Save
        </a>
      </div>
    </figure>
  );
}
