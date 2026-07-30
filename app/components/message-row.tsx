"use client";

import type { UIMessage } from "ai";
import { Check, Copy, FileText, RotateCcw, Share } from "lucide-react";
import { useState } from "react";
import { messageText } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { MarkdownRenderer } from "./markdown-renderer";

function messageFiles(message: UIMessage): Array<{ filename?: string; mediaType?: string }> {
  return message.parts.filter((part) => part.type === "file").map((part) => part as unknown as { filename?: string; mediaType?: string });
}

export function MessageRow({ message, streaming, theme, haptics, onRetry }: { message: UIMessage; streaming: boolean; theme: "dark" | "light"; haptics: boolean; onRetry?: () => void }) {
  const text = messageText(message);
  const files = messageFiles(message);
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  if (!text && files.length === 0 && !streaming) return null;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    haptic("success", haptics);
    window.setTimeout(() => setCopied(false), 1_300);
  }

  async function share() {
    haptic("selection", haptics);
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // Cancelled by the user.
      }
      return;
    }
    await copy();
  }

  return (
    <article data-message-id={message.id} data-role={message.role} className={`navi-message-enter flex ${user ? "justify-end" : "justify-start"}`}>
      {user ? (
        <div className="max-w-[85%] rounded-[18px] bg-[var(--bg-bubble-user)] px-4 py-2.5 text-[16px]/[24px] font-normal text-primary">
          {files.length ? <div className="mb-2 flex flex-wrap gap-1.5">{files.map((file, index) => <span key={`${file.filename}-${index}`} className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-elev-3 px-2 text-[11px]/[14px] font-semibold text-secondary"><FileText size={13} />{file.filename ?? file.mediaType ?? "Attachment"}</span>)}</div> : null}
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
      ) : (
        <div className="group w-full">
          <div className={`navi-markdown text-[16px]/[26px] font-normal ${streaming ? "streaming-cursor" : ""}`}>
            {text ? <MarkdownRenderer text={text} theme={theme} haptics={haptics} /> : null}
          </div>
          {!streaming && text ? (
            <div className="mt-1.5 flex min-h-9 items-center gap-1 opacity-100 transition-opacity duration-[120ms] md:opacity-0 md:group-hover:opacity-100">
              <button type="button" onClick={() => void copy()} className="flex h-9 w-9 items-center justify-center rounded-full text-tertiary active:bg-elev-2" aria-label={copied ? "Copied" : "Copy response"}>
                {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
              </button>
              <button type="button" onClick={() => void share()} className="flex h-9 w-9 items-center justify-center rounded-full text-tertiary active:bg-elev-2" aria-label="Share response">
                <Share size={16} />
              </button>
              {onRetry ? (
                <button type="button" onClick={() => { haptic("selection", haptics); onRetry(); }} className="flex h-9 w-9 items-center justify-center rounded-full text-tertiary active:bg-elev-2" aria-label="Retry response">
                  <RotateCcw size={16} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
