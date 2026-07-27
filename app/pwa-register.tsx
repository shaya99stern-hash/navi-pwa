"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    void import("workbox-window")
      .then(async ({ Workbox }) => {
        if (cancelled) return;
        const workbox = new Workbox("/sw.js", { scope: "/" });
        workbox.addEventListener("waiting", () => workbox.messageSkipWaiting());
        workbox.addEventListener("controlling", () => window.location.reload());
        await workbox.register();
      })
      .catch((error) => console.error("Navi service-worker registration failed:", error));

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
