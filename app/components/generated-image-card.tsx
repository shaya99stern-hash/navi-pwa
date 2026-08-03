"use client";

import { Download, ExternalLink, Image as ImageIcon } from "lucide-react";
import { useMemo } from "react";
import type { GeneratedImagePayload } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";

function extensionFor(mimeType: GeneratedImagePayload["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function safeFileName(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "navi-image";
  return `${base}.${extension}`;
}

export function GeneratedImageCard({ payload, haptics }: { payload: GeneratedImagePayload; haptics: boolean }) {
  const dataUrl = useMemo(() => `data:${payload.mimeType};base64,${payload.data}`, [payload.data, payload.mimeType]);
  const fileName = safeFileName(payload.title, extensionFor(payload.mimeType));

  return (
    <figure className="my-4 overflow-hidden rounded-[22px] border border-[var(--border-subtle)] bg-elev-2 shadow-sm">
      <div className="flex min-h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <ImageIcon size={17} className="shrink-0 text-accent" />
        <figcaption className="min-w-0 flex-1 truncate text-[0.875rem]/5 font-semibold text-primary">{payload.title}</figcaption>
        {/* The engine carries Navi's own name for it, never the raw model id. */}
        <span className="shrink-0 text-[0.625rem]/3 font-semibold uppercase tracking-[0.1em] text-tertiary">{payload.engine ?? "Navi Image"}</span>
      </div>

      <div className="bg-black/20 p-2">
        <img
          src={dataUrl}
          alt={payload.alt}
          width={payload.width}
          height={payload.height}
          loading="lazy"
          decoding="async"
          className="block h-auto max-h-[72dvh] w-full rounded-[16px] object-contain"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-2">
        <a
          href={dataUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => haptic("selection", haptics)}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[14px] bg-elev-3 px-3 text-[0.8125rem]/5 font-semibold text-primary active:opacity-70"
        >
          <ExternalLink size={16} /> Open full size
        </a>
        <a
          href={dataUrl}
          download={fileName}
          onClick={() => haptic("success", haptics)}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[14px] bg-accent px-3 text-[0.8125rem]/5 font-semibold text-white active:bg-accent-pressed"
        >
          <Download size={16} /> Save image
        </a>
      </div>
    </figure>
  );
}
