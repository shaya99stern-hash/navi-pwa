"use client";

import type { UIMessage } from "ai";
import { Check, CircleCheck, Copy, FileText, LoaderCircle, PlugZap, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { messageText } from "@/lib/chat";
import { haptic } from "@/lib/ui/haptics";
import { MarkdownRenderer } from "./markdown-renderer";

function messageFiles(message: UIMessage): Array<{ filename?: string; mediaType?: string }> {
  return message.parts.filter((part) => part.type === "file").map((part) => part as unknown as { filename?: string; mediaType?: string });
}

type DynamicToolPart = {
  type: "dynamic-tool";
  toolName: string;
  state: string;
  errorText?: string;
};

function messageTools(message: UIMessage): DynamicToolPart[] {
  return message.parts
    .filter((part) => part.type === "dynamic-tool")
    .map((part) => part as unknown as DynamicToolPart);
}

function readableToolName(value: string): string {
  return value
    .replace(/^mcp_/, "")
    .replace(/_\d+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80) || "connector";
}

export function MessageRow({ message, streaming, theme, haptics }: { message: UIMessage; streaming: boolean; theme: "dark" | "light"; haptics: boolean }) {
  const text = messageText(message);
  const files = messageFiles(message);
  const tools = messageTools(message);
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  if (!text && files.length === 0 && tools.length === 0 && !streaming) return null;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    haptic("success", haptics);
    window.setTimeout(() => setCopied(false), 1_300);
  }

  return (
    <article className={`navi-message-enter flex ${user ? "justify-end" : "justify-start"}`}>
      {user ? (
        <div className="max-w-[88%] rounded-[20px] bg-elev-2 px-4 py-3 text-[15px]/[22px] font-normal text-primary">
          {files.length ? <div className="mb-2 flex flex-wrap gap-1.5">{files.map((file, index) => <span key={`${file.filename}-${index}`} className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-elev-3 px-2 text-[11px]/[14px] font-semibold text-secondary"><FileText size={13} />{file.filename ?? file.mediaType ?? "Attachment"}</span>)}</div> : null}
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
      ) : (
        <div className="group w-full">
          {tools.length ? (
            <div className="mb-3 space-y-2" aria-label="Connector activity">
              {tools.map((tool, index) => {
                const pending = tool.state === "input-streaming" || tool.state === "input-available";
                const failed = tool.state === "output-error" || tool.state === "output-denied";
                return (
                  <div key={`${tool.toolName}-${index}`} className="flex min-h-11 items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-elev-1 px-3 py-2 text-[12px]/4 text-secondary">
                    {pending
                      ? <LoaderCircle size={16} className="shrink-0 animate-spin text-accent" />
                      : failed
                        ? <TriangleAlert size={16} className="shrink-0 text-danger" />
                        : <CircleCheck size={16} className="shrink-0 text-accent" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-primary">
                        {pending ? "Using connector" : failed ? "Connector unavailable" : "Connector source ready"}
                      </span>
                      <span className="block truncate text-[11px] text-tertiary">{readableToolName(tool.toolName)}</span>
                    </span>
                    <PlugZap size={15} className="shrink-0 text-tertiary" />
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className={`navi-markdown text-[15px]/[22px] font-normal ${streaming ? "streaming-cursor" : ""}`}>
            {text ? <MarkdownRenderer text={text} theme={theme} haptics={haptics} /> : null}
          </div>
          {!streaming && text ? (
            <div className="mt-2 flex min-h-9 items-center opacity-100 transition-opacity duration-[120ms] md:opacity-0 md:group-hover:opacity-100">
              <button type="button" onClick={() => void copy()} className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-[12px]/4 font-medium text-tertiary active:bg-elev-2" aria-label="Copy response">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</button>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
