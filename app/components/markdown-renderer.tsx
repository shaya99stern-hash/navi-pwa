"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ArtifactPayload } from "@/lib/ai/types";
import { validateGeneratedImagePayload } from "@/lib/security/generated-images";
import { validateGeneratedAudioPayload } from "@/lib/security/generated-audio";
import { validateArtifactPayload } from "@/lib/security/artifacts";
import { ArtifactFrame } from "./artifact-frame";
import { CodeBlock } from "./code-block";
import { parseSkillMarkdown, type Playbook } from "@/lib/playbooks";
import { CapabilityCard } from "./capability-card";
import { GeneratedAudioCard } from "./generated-audio-card";
import { GeneratedImageCard } from "./generated-image-card";

/**
 * Memoised because it is the most expensive thing the thread renders. Every
 * throttled frame of a stream re-renders the whole message list, and without
 * this the markdown parser re-tokenises every prior message each time — the
 * cost grows with history length until a long chat blocks the main thread for
 * the entire response. Props are primitives, so the default comparison is
 * exactly right: only the message whose text actually changed re-parses.
 */
export type CapabilityHandlers = {
  /** Ids already installed, so a card reopened later shows its real state. */
  installedIds: string[];
  onInstall: (playbook: Omit<Playbook, "source">) => void;
  onRemove: (id: string) => void;
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ text, theme, haptics, capabilities }: {
  text: string;
  theme: "dark" | "light";
  haptics: boolean;
  capabilities?: CapabilityHandlers;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const value = String(children);
          const match = /language-([\w-]+)/.exec(className ?? "");
          const language = match?.[1] ?? "";
          const inline = !className && !value.includes("\n");
          if (inline) return <code>{children}</code>;

          if (language === "navi-image") {
            try {
              const validation = validateGeneratedImagePayload(JSON.parse(value.trim()));
              if (validation.ok) return <GeneratedImageCard payload={validation.payload} haptics={haptics} />;
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Invalid generated image: {validation.error}</div>;
            } catch {
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Malformed generated image payload.</div>;
            }
          }

          /* A capability Navi drafted. Parsed with the same reader that
             handles a pasted SKILL.md, so anything installable from Settings
             is installable from a message and vice versa. */
          if (language === "navi-capability") {
            if (!capabilities) return null;
            const parsed = parseSkillMarkdown(value.trim());
            if ("error" in parsed) {
              return <div className="my-3 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-tertiary">Navi drafted a capability that could not be read: {parsed.error}</div>;
            }
            return (
              <CapabilityCard
                playbook={parsed.playbook}
                installed={capabilities.installedIds.includes(parsed.playbook.id)}
                haptics={haptics}
                onInstall={capabilities.onInstall}
                onRemove={capabilities.onRemove}
              />
            );
          }

          if (language === "navi-audio") {
            try {
              const validation = validateGeneratedAudioPayload(JSON.parse(value.trim()));
              if (validation.ok) return <GeneratedAudioCard payload={validation.payload} haptics={haptics} />;
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Invalid generated audio: {validation.error}</div>;
            } catch {
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Malformed generated audio payload.</div>;
            }
          }

          if (language === "navi-artifact") {
            try {
              const validation = validateArtifactPayload(JSON.parse(value.trim()));
              if (validation.ok) return <ArtifactFrame payload={validation.payload} theme={theme} haptics={haptics} />;
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Invalid artifact: {validation.error}</div>;
            } catch {
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.8125rem]/[1.125rem] text-primary">Malformed artifact payload.</div>;
            }
          }

          if (language === "navi-svg") {
            const payload: ArtifactPayload = { id: `svg-${value.length}`, title: "SVG output", kind: "svg", svg: value, height: 360 };
            return <ArtifactFrame payload={payload} theme={theme} haptics={haptics} />;
          }

          return <CodeBlock code={value} language={language || "text"} theme={theme} haptics={haptics} />;
        },
        a: ({ href, children, ...props }) => <a {...props} href={href} target="_blank" rel="noreferrer noopener">{children}</a>
      }}
    >
      {text}
    </ReactMarkdown>
  );
});
