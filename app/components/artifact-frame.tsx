"use client";

import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactPayload } from "@/lib/ai/types";
import { buildArtifactDocument } from "@/lib/security/artifacts";
import { haptic } from "@/lib/ui/haptics";

export function ArtifactFrame({ payload, theme, haptics }: { payload: ArtifactPayload; theme: "dark" | "light"; haptics: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(payload.height ?? 360);
  const document = useMemo(() => buildArtifactDocument(payload, theme), [payload, theme]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "280px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function receive(event: MessageEvent) {
      const data = event.data as { type?: string; id?: string; height?: number };
      if (data.id !== payload.id) return;
      if ((data.type === "artifact:ready" || data.type === "artifact:resize") && typeof data.height === "number") {
        setHeight(Math.min(900, Math.max(180, data.height)));
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [payload.id]);

  function toggle() {
    setExpanded((value) => !value);
    haptic("impact-light", haptics);
  }

  return (
    <div ref={wrapperRef} className="my-4 overflow-hidden rounded-[20px] border border-[var(--border-subtle)] bg-elev-2">
      <div className="flex min-h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <span className="min-w-0 flex-1 truncate text-[13px]/[18px] font-semibold text-primary">{payload.title}</span>
        <span className="text-[11px]/[14px] font-semibold uppercase tracking-[0.08em] text-tertiary">Artifact</span>
        <button type="button" onClick={toggle} className="flex h-10 w-10 items-center justify-center rounded-xl text-secondary active:bg-[var(--bg-elev-3)]" aria-label={expanded ? "Collapse artifact" : "Expand artifact"}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
      </div>
      <div className="overflow-hidden transition-[height] duration-[180ms]" style={{ height: expanded ? height : 0 }}>
        {visible && expanded ? (
          <iframe
            title={payload.title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="lazy"
            allow="clipboard-read; clipboard-write"
            srcDoc={document}
            className="block w-full border-0 bg-transparent"
            style={{ height }}
          />
        ) : null}
      </div>
      <div className="flex min-h-9 items-center gap-2 border-t border-[var(--border-subtle)] px-4 text-[11px]/[14px] font-semibold text-tertiary"><ExternalLink size={13} />Isolated sandbox · no parent access</div>
    </div>
  );
}
