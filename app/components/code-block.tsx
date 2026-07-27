"use client";

import { Check, Copy, WrapText } from "lucide-react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { useState } from "react";
import { haptic } from "@/lib/ui/haptics";

const LANGUAGE_ALIASES: Record<string, Language> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  sh: "bash",
  shell: "bash",
  html: "markup",
  xml: "markup",
  svg: "markup",
  yml: "yaml"
};

export function CodeBlock({ code, language, theme, haptics }: { code: string; language: string; theme: "dark" | "light"; haptics: boolean }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const prismLanguage = (LANGUAGE_ALIASES[language] ?? (language || "text")) as Language;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    haptic("success", haptics);
    window.setTimeout(() => setCopied(false), 1_300);
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elev-2)]">
      <div className="flex min-h-10 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elev-3)] px-3">
        <span className="text-[11px]/[14px] font-semibold uppercase tracking-[0.08em] text-tertiary">{language || "text"}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWrap((value) => !value)} className="flex h-9 w-9 items-center justify-center rounded-lg text-tertiary active:bg-black/10" aria-label={wrap ? "Disable code wrapping" : "Wrap code"}><WrapText size={16} /></button>
          <button type="button" onClick={() => void copy()} className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-tertiary active:bg-black/10" aria-label="Copy code">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
        </div>
      </div>
      <Highlight theme={theme === "dark" ? themes.vsDark : themes.github} code={code.replace(/\n$/, "")} language={prismLanguage}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`${className} m-0 max-w-full overflow-x-auto p-4 text-[13px]/5 font-medium ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`} style={{ ...style, background: "transparent" }}>
            {tokens.map((line, index) => (
              <div key={index} {...getLineProps({ line })}>
                {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })} />)}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
