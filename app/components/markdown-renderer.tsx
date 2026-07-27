"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ArtifactPayload } from "@/lib/ai/types";
import { validateGeneratedImagePayload } from "@/lib/security/generated-images";
import { validateArtifactPayload } from "@/lib/security/artifacts";
import { ArtifactFrame } from "./artifact-frame";
import { CodeBlock } from "./code-block";
import { GeneratedImageCard } from "./generated-image-card";

export function MarkdownRenderer({ text, theme, haptics }: { text: string; theme: "dark" | "light"; haptics: boolean }) {
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
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[13px]/[18px] text-primary">Invalid generated image: {validation.error}</div>;
            } catch {
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[13px]/[18px] text-primary">Malformed generated image payload.</div>;
            }
          }

          if (language === "navi-artifact") {
            try {
              const validation = validateArtifactPayload(JSON.parse(value.trim()));
              if (validation.ok) return <ArtifactFrame payload={validation.payload} theme={theme} haptics={haptics} />;
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[13px]/[18px] text-primary">Invalid artifact: {validation.error}</div>;
            } catch {
              return <div className="my-3 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[13px]/[18px] text-primary">Malformed artifact payload.</div>;
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
}
