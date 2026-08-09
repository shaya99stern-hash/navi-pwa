"use client";

import { FileText, Shapes, X } from "lucide-react";
import type { StoredChat } from "@/lib/ai/types";
import { messageText } from "@/lib/chat";
import { isArtifactFenceLanguage, looksLikeArtifactFence, recoverArtifactPayload } from "@/lib/security/artifacts";
import { haptic } from "@/lib/ui/haptics";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

type Artifact = { key: string; title: string; kind: string; chat: StoredChat };

/**
 * Artifacts are embedded in replies as fenced payloads.
 *
 * This must recognise exactly what the chat renders, or the library
 * contradicts the conversation — an artifact visible in a message but absent
 * from this list reads as it having been lost. So it accepts the same fence
 * aliases and runs the same salvage, rather than a stricter parse of its own.
 */
function collectArtifacts(chats: StoredChat[]): Artifact[] {
  return chats.flatMap((chat) =>
    chat.messages.flatMap((message) =>
      [...messageText(message).matchAll(/```([\w-]*)\s*\n([\s\S]*?)```/g)].flatMap((match, index) => {
        const [, language = "", body = ""] = match;
        if (!isArtifactFenceLanguage(language)) return [];
        if (language.toLowerCase() !== "navi-artifact" && !looksLikeArtifactFence(body)) return [];
        const recovered = recoverArtifactPayload(body);
        if (!recovered.ok) return [];
        return [{
          key: `${chat.id}-${recovered.payload.id || index}`,
          title: recovered.payload.title,
          kind: recovered.payload.kind,
          chat
        }];
      })
    )
  );
}

export function ArtifactsSheet({
  open,
  chats,
  haptics,
  onClose,
  onOpenChat
}: {
  open: boolean;
  chats: StoredChat[];
  haptics: boolean;
  onClose: () => void;
  onOpenChat: (chat: StoredChat) => void;
}) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics });
  if (!open) return null;
  const artifacts = collectArtifacts(chats);

  return (
    <div className="fixed inset-0 z-[95]">
      <button type="button" aria-label="Close artifacts" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Artifacts"
        className="navi-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-[720px] flex-col overflow-hidden md:max-w-[480px]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1">
          <div className="navi-sheet-grabber" />
        </div>

        <header className="flex h-12 shrink-0 items-center justify-between px-4">
          <div className="text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary">Artifacts</div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-elev-2 text-secondary active:bg-elev-3">
            <X size={18} />
          </button>
        </header>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(16px+var(--safe-bottom))]" data-sheet-scroll="true">
          {artifacts.length ? artifacts.map((artifact) => (
            <button
              key={artifact.key}
              type="button"
              onClick={() => { haptic("selection", haptics); onClose(); onOpenChat(artifact.chat); }}
              className="flex min-h-[62px] w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-elev-2 text-accent">
                <FileText size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem]/[1.375rem] font-medium text-primary">{artifact.title}</span>
                <span className="block truncate text-[0.75rem]/4 font-medium text-tertiary">{artifact.kind} · {artifact.chat.title}</span>
              </span>
            </button>
          )) : (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <Shapes size={24} className="text-tertiary" />
              <div className="text-[0.9375rem]/[1.375rem] font-medium text-primary">No artifacts yet</div>
              <p className="max-w-[300px] text-[0.8125rem]/[1.1875rem] font-medium text-tertiary">
                Interactive tools and documents made in a chat collect here.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
