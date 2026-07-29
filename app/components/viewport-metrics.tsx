"use client";

import { useEffect } from "react";

function px(value: number): string {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}

export function ViewportMetrics() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    let settleTimer = 0;
    let stableLayoutHeight = Math.max(
      window.innerHeight,
      root.clientHeight,
      (viewport?.height ?? 0) + (viewport?.offsetTop ?? 0)
    );

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visibleHeight = viewport?.height ?? window.innerHeight;
        const visibleWidth = viewport?.width ?? window.innerWidth;
        const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
        const offsetLeft = Math.max(0, viewport?.offsetLeft ?? 0);
        const activeElement = document.activeElement;
        const hasTextInput = activeElement instanceof HTMLInputElement
          || activeElement instanceof HTMLTextAreaElement
          || activeElement instanceof HTMLSelectElement
          || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
        const visibleBottom = visibleHeight + offsetTop;

        if (!hasTextInput && visibleBottom > stableLayoutHeight - 48) {
          stableLayoutHeight = Math.max(window.innerHeight, root.clientHeight, visibleBottom);
        }

        const keyboardInset = Math.max(0, stableLayoutHeight - visibleBottom);
        const keyboardOpen = hasTextInput && keyboardInset > 80;

        root.style.setProperty("--navi-viewport-height", px(visibleHeight));
        root.style.setProperty("--navi-viewport-width", px(visibleWidth));
        root.style.setProperty("--navi-viewport-offset-top", px(offsetTop));
        root.style.setProperty("--navi-viewport-offset-left", px(offsetLeft));
        root.style.setProperty("--navi-keyboard-inset", px(keyboardInset));
        root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
      });
    };

    const settle = () => {
      window.clearTimeout(settleTimer);
      update();
      settleTimer = window.setTimeout(update, 180);
    };

    const resetForOrientation = () => {
      stableLayoutHeight = 0;
      settle();
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", resetForOrientation, { passive: true });
    window.addEventListener("pageshow", settle, { passive: true });
    document.addEventListener("focusin", settle, { passive: true });
    document.addEventListener("focusout", settle, { passive: true });
    viewport?.addEventListener("resize", update, { passive: true });
    viewport?.addEventListener("scroll", update, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", resetForOrientation);
      window.removeEventListener("pageshow", settle);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      root.style.removeProperty("--navi-viewport-height");
      root.style.removeProperty("--navi-viewport-width");
      root.style.removeProperty("--navi-viewport-offset-top");
      root.style.removeProperty("--navi-viewport-offset-left");
      root.style.removeProperty("--navi-keyboard-inset");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
