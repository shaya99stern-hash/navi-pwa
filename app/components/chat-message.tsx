import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { messageText } from "../lib/chat";

export function ChatMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const text = messageText(message);
  const user = message.role === "user";
  if (!text && !streaming) return null;

  return (
    <article className={`mb-7 flex ${user ? "justify-end" : "justify-start"}`}>
      {user ? (
        <div className="max-w-[86%] rounded-[22px] bg-[#2f2f2f] px-4 py-2.5 text-[16px] leading-6 text-neutral-100">
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
      ) : (
        <div className={`navi-markdown w-full text-[16px] text-neutral-100 ${streaming ? "streaming-cursor" : ""}`}>
          {text ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => (
                  <a {...props} href={href} target="_blank" rel="noreferrer noopener">{children}</a>
                )
              }}
            >
              {text}
            </ReactMarkdown>
          ) : null}
        </div>
      )}
    </article>
  );
}
