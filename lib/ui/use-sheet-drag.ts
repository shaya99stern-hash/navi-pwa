"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "./haptics";

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.55; // px per ms
const MIN_EXIT_MS = 140;
const MAX_EXIT_MS = 320;
/** Used when the sheet element has not measured yet. */
const FALLBACK_EXIT_DISTANCE = 520;

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
    ref: (node: HTMLElement | null) => void;
    style: CSSProperties;
    onAnimationEnd: () => void;
  };
  /** Spread onto the scrim so it fades in step with the drag. */
  scrimProps: { style: CSSProperties };
  /** 0 → fully open, 1 → gone. Use to fade the scrim. */
  progress: number;
};

/**
 * Drag-to-dismiss for bottom sheets: follows the finger, resists upward pulls,
 * and closes on either distance or a fast downward flick, the way a native
 * sheet does. Only the grab area starts a drag, so content inside the sheet
 * can still scroll normally.
 *
 * A dismissal throws the sheet off the bottom edge and only unmounts once it is
 * out of frame — returning it to the open position first would read as the
 * sheet snapping back and then vanishing.
 */
export function useSheetDrag({ onDismiss, haptics = true }: { onDismiss: () => void; haptics?: boolean }): SheetDrag {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exit, setExit] = useState<{ distance: number; duration: number } | null>(null);
  // The entry keyframes animate `transform` with fill-mode both, which would
  // keep overriding the inline transform once they finish.
  const [entered, setEntered] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);
  const latest = useRef<{ y: number; t: number } | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!event.isPrimary || exit) return;
    const point = { y: event.clientY, t: event.timeStamp };
    start.current = point;
    latest.current = point;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [exit]);

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

    if (delta <= DISMISS_DISTANCE && velocity <= DISMISS_VELOCITY) {
      setOffset(0);
      return;
    }

    // Carry the flick's speed into the exit so a hard throw leaves faster than
    // a slow drag past the threshold.
    const rect = sheet.current?.getBoundingClientRect();
    const distance = Math.max(rect ? rect.height - delta + 24 : FALLBACK_EXIT_DISTANCE, 120);
    const duration = Math.round(Math.min(MAX_EXIT_MS, Math.max(MIN_EXIT_MS, distance / Math.max(velocity, 1.4))));
    haptic("impact-light", haptics);
    setExit({ distance: delta + distance, duration });
    exitTimer.current = window.setTimeout(onDismiss, duration);
  }, [haptics, onDismiss]);

  const translate = exit ? exit.distance : offset;
  const progress = exit ? 1 : Math.min(1, Math.max(0, offset / DISMISS_DISTANCE));

  return {
    dragging,
    progress,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
      style: { touchAction: "none", cursor: "grab" }
    },
    sheetProps: {
      ref: (node) => { sheet.current = node; },
      onAnimationEnd: () => setEntered(true),
      style: {
        transform: translate ? `translateY(${translate}px)` : undefined,
        transition: dragging
          ? "none"
          : exit
            ? `transform ${exit.duration}ms cubic-bezier(0.3, 0, 0.8, 0.15)`
            : "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
        ...(entered || exit ? { animation: "none" } : null)
      }
    },
    scrimProps: {
      style: {
        // The scrim tracks the sheet so light dips read as the sheet lifting away.
        opacity: 1 - progress * (exit ? 1 : 0.55),
        transition: dragging ? "none" : `opacity ${exit ? exit.duration : 300}ms ease-out`
      }
    }
  };
}
