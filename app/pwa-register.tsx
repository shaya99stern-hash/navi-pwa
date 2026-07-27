"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    async function register() {
      try {
        const { Workbox } = await import("workbox-window");

        if (cancelled) {
          return;
        }

        const workbox = new Workbox("/sw.js", { scope: "/" });

        workbox.addEventListener("waiting", () => {
          workbox.messageSkipWaiting();
        });

        workbox.addEventListener("controlling", () => {
          window.location.reload();
        });

        await workbox.register();
      } catch (error) {
        console.error("Navi service-worker registration failed:", error);
      }
    }

    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
