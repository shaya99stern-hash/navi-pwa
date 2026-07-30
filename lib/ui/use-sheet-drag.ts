"use client";

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "./haptics";

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.55; // px per ms

type SheetDrag = {
  dragging: boolean;
  /** Spread onto the grab area (grabber, header) that initiates the drag. */
  handleProps: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: (event: ReactPointerEvent) => void;
    onPointerCancel: (event: ReactPointerEvent) => void;
    style: CSSProperties;
  };
  /** Spread onto the sheet element itself. */
  sheetProps: {
    style: CSSProperties;
    onAnimationEnd: () => void;
  };
  /** 0 → fully open, 1 → at the dismiss threshold. Use to fade the scrim. */
  progress: number;
};

/**
 * Drag-to-dismiss for bottom sheets: follows the finger, resists upward pulls,
 * and closes on either distance or a fast downward flick, the way a native
 * sheet does. Only the grab area starts a drag, so content inside the sheet
 * can still scroll normally.
 */
export function useSheetDrag({ onDismiss, haptics = true }: { onDismiss: () => void; haptics?: boolean }): SheetDrag {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The entry keyframes animate `transform` with fill-mode both, which would
  // keep overriding the inline transform once they finish.
  const [entered, setEntered] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);
  const latest = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!event.isPrimary) return;
    const point = { y: event.clientY, t: event.timeStamp };
    start.current = point;
    latest.current = point;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    if (!start.current) return;
    const delta = event.clientY - start.current.y;
    latest.current = { y: event.clientY, t: event.timeStamp };
    // Pulling up past the open position gets heavy rather than lifting off.
    setOffset(delta > 0 ? delta : delta / 5);
  }, []);

  const settle = useCallback((event: ReactPointerEvent) => {
    const from = start.current;
    if (!from) return;
    const delta = event.clientY - from.y;
    const elapsed = Math.max(1, (latest.current?.t ?? event.timeStamp) - from.t);
    const velocity = delta / elapsed;
    start.current = null;
    latest.current = null;
    setDragging(false);
    setOffset(0);
    if (delta > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      haptic("impact-light", haptics);
      onDismiss();
    }
  }, [haptics, onDismiss]);

  return {
    dragging,
    progress: Math.min(1, Math.max(0, offset / DISMISS_DISTANCE)),
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
      style: { touchAction: "none", cursor: "grab" }
    },
    sheetProps: {
      onAnimationEnd: () => setEntered(true),
      style: {
        transform: offset ? `translateY(${offset}px)` : undefined,
        transition: dragging ? "none" : "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
        ...(entered ? { animation: "none" } : null)
      }
    }
  };
}
