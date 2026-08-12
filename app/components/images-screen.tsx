"use client";

import { useMemo } from "react";
import type { StoredChat } from "@/lib/ai/types";
import { collectImages } from "@/lib/ui/library";
import { haptic } from "@/lib/ui/haptics";

/**
 * Every image Navi Soul has made, in one grid.
 *
 * Generated images live inside the reply that produced them, so this is the
 * only screen on which a picture from last week is reachable without
 * remembering the conversation. Tapping one goes back to that conversation,
 * where the full card — with its save and share actions — already exists.
 */
export function ImagesScreen({
  chats,
  haptics,
  onOpenChat
}: {
  chats: StoredChat[];
  haptics: boolean;
  onOpenChat: (chatId: string) => void;
}) {
  const images = useMemo(() => collectImages(chats), [chats]);

  return (
    <div className="navi-screen min-h-full px-gutter pb-6 pt-3.5">
      <div className="mx-auto w-full max-w-app">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[1.625rem]/8 tracking-[-0.02em] text-primary">Images</h2>
          <span className="shrink-0 text-[0.75rem]/[1.05rem] font-medium text-tertiary">{images.length} generated</span>
        </div>
        <p className="mb-4 mt-1.5 max-w-[34ch] text-[0.84375rem]/[1.265rem] font-normal text-tertiary">
          Long-press any image to save it to Photos or send it back into a conversation.
        </p>

        {images.length ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => { haptic("selection", haptics); onOpenChat(image.chatId); }}
                className="relative flex aspect-square items-end overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-elev-2 p-2.5 text-left active:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.alt || image.title}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {/* The caption sits on a scrim of its own so it stays legible
                    over a light image as well as a dark one. */}
                <span className="relative z-10 line-clamp-2 rounded-md bg-black/45 px-1.5 py-1 text-[0.71875rem]/[0.9375rem] font-medium text-white backdrop-blur-[2px]">
                  {image.title}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] border border-[var(--border-subtle)] bg-surface px-5 py-10 text-center">
            <p className="text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
              Images Navi Soul generates for you appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
