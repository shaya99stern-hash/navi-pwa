"use client";

import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Pencil,
  Share2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ArtifactPayload } from "@/lib/ai/types";
import { buildArtifactDocument } from "@/lib/security/artifacts";
import { haptic } from "@/lib/ui/haptics";

function safeFileName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "navi-artifact";
}

export function ArtifactFrame({ payload, theme, haptics }: { payload: ArtifactPayload; theme: "dark" | "light"; haptics: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(payload.height ?? 360);
  const [notice, setNotice] = useState<string | null>(null);
  const artifactDocument = useMemo(() => buildArtifactDocument(payload, theme), [payload, theme]);
  const source = payload.kind === "svg" ? payload.svg ?? "" : payload.html ?? "";
  const fileName = `${safeFileName(payload.title)}.${payload.kind === "svg" ? "svg" : "html"}`;
  const fileContent = payload.kind === "svg" ? source : artifactDocument;
  const mimeType = payload.kind === "svg" ? "image/svg+xml" : "text/html";

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
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string; id?: string; height?: number };
      if (data.id !== payload.id) return;
      if ((data.type === "artifact:ready" || data.type === "artifact:resize") && typeof data.height === "number") {
        const next = Math.min(900, Math.max(180, data.height));
        setHeight((current) => {
          /* Ignore a report that merely echoes the height we just set, plus the
             body padding. That is the signature of content sized in viewport
             units: it fills whatever it is given, so honouring the report grows
             the frame, which grows the report, and the frame ratchets to its
             clamp with a dead region below content that never changed.

             The bridge no longer produces that report — but a client running a
             service-worker-cached build still does, and this is the half of the
             fix that reaches them without a reload. */
          const echo = next > current && next - current <= 40;
          return echo ? current : next;
        });
      }
      if (data.type === "artifact:interaction") haptic("selection", haptics);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [haptics, payload.id]);

  useEffect(() => {
    if (!fullScreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullScreen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function toggle() {
    setExpanded((value) => !value);
    haptic("impact-light", haptics);
  }

  async function copySource() {
    // On the gesture, not after the clipboard write; see code-block.tsx. The
    // notice below reports the outcome, which is what an outcome needs.
    haptic("selection", haptics);
    try {
      await navigator.clipboard.writeText(source || fileContent);
      setNotice("Artifact source copied");
    } catch {
      setNotice("Clipboard access was unavailable");
    }
  }

  function downloadArtifact() {
    const blob = new Blob([fileContent], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Downloaded ${fileName}`);
    haptic("success", haptics);
  }

  async function shareArtifact() {
    // On the gesture: the share sheet and the clipboard fallback are both
    // async, so a tick after either one has no activation left to fire on.
    haptic("selection", haptics);
    const file = new File([fileContent], fileName, { type: mimeType });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: payload.title, text: "Created with NaviOS", files: [file] });
        setNotice("Artifact shared");
      } else {
        await navigator.clipboard.writeText(source || fileContent);
        setNotice("Sharing is unavailable here; source copied instead");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("Artifact could not be shared");
    }
  }

  function editWithNavi() {
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-navi-composer]");
    const prompt = `Edit the artifact “${payload.title}”: `;
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, prompt);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      window.setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(prompt.length, prompt.length);
      }, 60);
    } else {
      window.dispatchEvent(new CustomEvent("navi:edit-artifact", {
        detail: { id: payload.id, title: payload.title, kind: payload.kind }
      }));
    }
    setFullScreen(false);
    setNotice("Edit request added to the composer");
    haptic("selection", haptics);
  }

  function openFullScreen() {
    setVisible(true);
    setFullScreen(true);
    haptic("impact-light", haptics);
  }

  const artifactIframe = (className: string, style?: CSSProperties) => (
    <iframe
      ref={iframeRef}
      title={payload.title}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      loading="lazy"
      allow="clipboard-read; clipboard-write"
      srcDoc={artifactDocument}
      className={className}
      style={style}
    />
  );

  return (
    <>
      <div ref={wrapperRef} className="my-4 overflow-hidden rounded-[20px] border border-[var(--border-subtle)] bg-elev-2">
        <div className="flex min-h-12 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
          <span className="min-w-0 flex-1 truncate text-[0.8125rem]/[1.125rem] font-semibold text-primary">{payload.title}</span>
          <span className="hidden text-[0.625rem]/[0.875rem] font-semibold uppercase tracking-[0.08em] text-tertiary sm:inline">Artifact</span>
          <button type="button" onClick={openFullScreen} className="flex h-10 w-10 items-center justify-center rounded-xl text-secondary active:bg-[var(--bg-elev-3)]" aria-label="Open artifact full screen"><Maximize2 size={17} /></button>
          <button type="button" onClick={toggle} className="flex h-10 w-10 items-center justify-center rounded-xl text-secondary active:bg-[var(--bg-elev-3)]" aria-label={expanded ? "Collapse artifact" : "Expand artifact"}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
        </div>
        <div className="overflow-hidden transition-[height] duration-[180ms]" style={{ height: expanded ? height : 0 }}>
          {visible && expanded && !fullScreen ? artifactIframe("block w-full border-0 bg-transparent", { height }) : null}
        </div>
        <div className="flex min-h-11 items-center gap-1 overflow-x-auto border-t border-[var(--border-subtle)] px-2 scrollbar-none">
          <button type="button" onClick={editWithNavi} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3"><Pencil size={14} />Edit</button>
          <button type="button" onClick={() => void copySource()} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3"><Clipboard size={14} />Copy</button>
          <button type="button" onClick={downloadArtifact} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3"><Download size={14} />Download</button>
          <button type="button" onClick={() => void shareArtifact()} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[0.6875rem]/4 font-semibold text-secondary active:bg-elev-3"><Share2 size={14} />Share</button>
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 px-2 text-[0.625rem]/4 font-semibold text-tertiary sm:flex"><MousePointerClick size={13} />Saved in this conversation</span>
        </div>
        {notice ? <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-center text-[0.625rem]/4 font-semibold text-accent" role="status" aria-live="polite">{notice}</div> : null}
      </div>

      {fullScreen ? (
        <div className="fixed inset-0 z-[140] flex flex-col bg-app text-primary">
          <header className="safe-top flex min-h-[64px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-elev-1 px-3">
            <button type="button" onClick={() => setFullScreen(false)} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close full-screen artifact"><X size={21} /></button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1rem]/5 font-semibold text-primary">{payload.title}</span>
              <span className="block text-[0.625rem]/4 font-semibold uppercase tracking-[0.08em] text-tertiary">Interactive artifact</span>
            </span>
            <button type="button" onClick={editWithNavi} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Edit artifact with Navi Soul"><Pencil size={18} /></button>
            <button type="button" onClick={downloadArtifact} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Download artifact"><Download size={18} /></button>
            <button type="button" onClick={() => void shareArtifact()} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Share artifact"><Share2 size={18} /></button>
          </header>
          <main className="min-h-0 flex-1 bg-elev-2">
            {artifactIframe("block h-full w-full border-0 bg-transparent", { height: "100%" })}
          </main>
          <footer className="flex min-h-[52px] shrink-0 items-center justify-center gap-2 border-t border-[var(--border-subtle)] bg-elev-1 px-4 pb-[var(--safe-bottom)] text-[0.625rem]/4 font-semibold text-tertiary">
            <Minimize2 size={14} />Secure sandbox · no network, navigation, or parent access
          </footer>
        </div>
      ) : null}
    </>
  );
}
