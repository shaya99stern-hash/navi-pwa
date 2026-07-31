"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "./haptics";

/** Distance over which the drawer travels its full width. */
const EDGE_SWIPE_WIDTH = 300;
/** Where the drawer starts from — wider than a hairline so a thumb can find it. */
const EDGE_ZONE = 26;
/** Past this fraction the drawer commits on release. */
const COMMIT_AT = 0.35;
/** A drag this much more vertical than horizontal is a scroll, not a swipe. */
const SCROLL_SLOP = 12;
/** Fallback for a flick too fast to register intermediate moves. */
const FLICK_DISTANCE = 62;
const FLICK_DRIFT = 70;

export type EdgeSwipe = {
  /** 0-1 while a swipe is in progress, null when idle. */
  progress: number | null;
  handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: (event: ReactPointerEvent) => void;
  };
};

/**
 * Left-edge swipe that opens a drawer under the thumb rather than snapping at a
 * threshold, so the drawer tracks the finger and can be abandoned mid-gesture.
 */
export function useEdgeSwipe({
  disabled,
  haptics,
  onOpen
}: {
  disabled: boolean;
  haptics: boolean;
  onOpen: () => void;
}): EdgeSwipe {
  const [progress, setProgress] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Mirrors `progress` so release can read it without a state updater, which
  // must stay pure — React is free to invoke one twice.
  const live = useRef<number | null>(null);

  const track = useCallback((next: number | null) => {
    live.current = next;
    setProgress(next);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (disabled || event.clientX > EDGE_ZONE) return;
    start.current = { x: event.clientX, y: event.clientY };
  }, [disabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const from = start.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = Math.abs(event.clientY - from.y);
    if (dy > Math.abs(dx) && dy > SCROLL_SLOP) {
      start.current = null;
      track(null);
      return;
    }
    if (dx <= 0) return;
    track(Math.min(1, dx / EDGE_SWIPE_WIDTH));
  }, [track]);

  const onPointerUp = useCallback((event: ReactPointerEvent) => {
    const from = start.current;
    const travelled = live.current;
    start.current = null;
    track(null);

    if (travelled !== null) {
      if (travelled > COMMIT_AT) {
        haptic("impact-light", haptics);
        onOpen();
      }
      return;
    }
    // No intermediate move fired, so judge the gesture by where it landed.
    if (from
      && event.clientX - from.x > FLICK_DISTANCE
      && Math.abs(event.clientY - from.y) < FLICK_DRIFT) {
      onOpen();
    }
  }, [haptics, onOpen, track]);

  return { progress, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
