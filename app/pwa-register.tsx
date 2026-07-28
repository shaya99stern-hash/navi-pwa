"use client";

import { useEffect } from "react";
import {
  PWA_UPDATE_REQUEST_EVENT,
  emitPwaUpdateStatus
} from "@/lib/pwa-update";

const AUTO_CHECK_INTERVAL_MS = 15 * 60 * 1_000;
const AUTO_CHECK_THROTTLE_MS = 5 * 60 * 1_000;

function waitForWorker(worker: ServiceWorker, timeoutMs = 6_000): Promise<void> {
  if (worker.state === "activated" || worker.state === "redundant" || worker.state === "installed") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", stateChange);
      resolve();
    };
    const stateChange = () => {
      if (worker.state === "activated" || worker.state === "redundant" || worker.state === "installed") finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    worker.addEventListener("statechange", stateChange);
  });
}

async function clearNaviShellCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("navi-")).map((key) => window.caches.delete(key)));
}

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let reloading = false;
    let applyingUpdate = false;
    let lastAutomaticCheck = 0;

    const showAvailable = (message = "A new Navi version is ready. Update when you are ready.") => {
      if (!cancelled) emitPwaUpdateStatus({ phase: "available", message });
    };

    const restartWithFreshShell = async () => {
      if (cancelled || reloading) return;
      reloading = true;
      emitPwaUpdateStatus({ phase: "restarting", message: "Refreshing Navi and applying the latest version…" });
      try {
        await clearNaviShellCaches();
        const freshUrl = new URL(window.location.href);
        freshUrl.searchParams.set("_navi_refresh", Date.now().toString(36));
        await fetch(freshUrl.toString(), { cache: "reload", credentials: "same-origin" }).catch(() => undefined);
      } finally {
        window.location.reload();
      }
    };

    const applyWaitingWorker = (): boolean => {
      const waiting = registration?.waiting;
      if (!waiting) return false;
      applyingUpdate = true;
      emitPwaUpdateStatus({ phase: "downloading", message: "Installing the ready Navi update…" });
      waiting.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(() => void restartWithFreshShell(), 4_000);
      return true;
    };

    const checkForUpdate = async (manual: boolean) => {
      if (cancelled || !navigator.onLine) {
        if (manual) emitPwaUpdateStatus({ phase: "error", message: "Navi is offline. Reconnect and try again." });
        return;
      }

      if (manual) emitPwaUpdateStatus({ phase: "checking", message: "Checking for the newest Navi version…" });

      try {
        registration = registration ?? await navigator.serviceWorker.getRegistration("/");
        if (registration) {
          if (manual && applyWaitingWorker()) return;
          await registration.update();
          if (registration.waiting) {
            if (manual) applyWaitingWorker();
            else showAvailable();
            return;
          }
          if (registration.installing) {
            if (manual) emitPwaUpdateStatus({ phase: "downloading", message: "Downloading the latest Navi version…" });
            await waitForWorker(registration.installing);
            if (reloading) return;
            if (registration.waiting) {
              if (manual) applyWaitingWorker();
              else showAvailable();
              return;
            }
          }
        }

        if (manual) {
          await restartWithFreshShell();
        } else {
          emitPwaUpdateStatus({ phase: "current", message: "Navi is up to date." });
        }
      } catch (error) {
        console.error("Navi update check failed:", error);
        if (manual) emitPwaUpdateStatus({ phase: "error", message: "Navi could not refresh. Check your connection and try again." });
      }
    };

    const automaticCheck = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || !navigator.onLine || now - lastAutomaticCheck < AUTO_CHECK_THROTTLE_MS) return;
      lastAutomaticCheck = now;
      void checkForUpdate(false);
    };

    const manualCheck = () => void checkForUpdate(true);
    const visibilityCheck = () => {
      if (document.visibilityState === "visible") automaticCheck();
    };
    const controllerChanged = () => {
      if (applyingUpdate) void restartWithFreshShell();
      else showAvailable("A newer Navi version is active. Restart when you are ready.");
    };

    window.addEventListener(PWA_UPDATE_REQUEST_EVENT, manualCheck);
    window.addEventListener("online", automaticCheck);
    document.addEventListener("visibilitychange", visibilityCheck);
    navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
    const interval = window.setInterval(automaticCheck, AUTO_CHECK_INTERVAL_MS);

    void import("workbox-window")
      .then(async ({ Workbox }) => {
        if (cancelled) return;
        const workbox = new Workbox("/sw.js", { scope: "/" });
        workbox.addEventListener("waiting", () => showAvailable());
        workbox.addEventListener("controlling", () => {
          if (applyingUpdate) void restartWithFreshShell();
        });
        registration = await workbox.register();
        if (registration?.waiting) showAvailable();
        window.setTimeout(automaticCheck, 1_200);
      })
      .catch((error) => {
        console.error("Navi service-worker registration failed:", error);
        emitPwaUpdateStatus({ phase: "error", message: "Automatic app updates are temporarily unavailable." });
      });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(PWA_UPDATE_REQUEST_EVENT, manualCheck);
      window.removeEventListener("online", automaticCheck);
      document.removeEventListener("visibilitychange", visibilityCheck);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);

  return null;
}
