"use client";

import { useEffect } from "react";

function px(value: number): string {
  return `${Math.max(0, Math.round(value))}px`;
}

export function ViewportMetrics() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const layoutHeight = window.innerHeight;
        const visibleHeight = viewport?.height ?? layoutHeight;
        const offsetTop = viewport?.offsetTop ?? 0;
        const keyboardInset = Math.max(0, layoutHeight - visibleHeight - offsetTop);

        root.style.setProperty("--navi-viewport-height", px(visibleHeight));
        root.style.setProperty("--navi-viewport-offset-top", px(offsetTop));
        root.style.setProperty("--navi-keyboard-inset", px(keyboardInset));
        root.dataset.keyboardOpen = keyboardInset > 80 ? "true" : "false";
      });
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });
    viewport?.addEventListener("resize", update, { passive: true });
    viewport?.addEventListener("scroll", update, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      root.style.removeProperty("--navi-viewport-height");
      root.style.removeProperty("--navi-viewport-offset-top");
      root.style.removeProperty("--navi-keyboard-inset");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
