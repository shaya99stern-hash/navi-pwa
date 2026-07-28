"use client";

import { useReportWebVitals } from "next/web-vitals";

export default function WebVitals() {
  useReportWebVitals((metric) => {
    const path = window.location.pathname;
    if (
      path === "/sign-in"
      || path.startsWith("/sign-in/")
      || path === "/sign-up"
      || path.startsWith("/sign-up/")
      || path === "/access-denied"
      || path === "/offline"
    ) {
      return;
    }

    const payload = JSON.stringify({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
      path,
      timestamp: Date.now()
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/vitals", new Blob([payload], { type: "application/json" }));
      return;
    }

    void fetch("/api/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    });
  });

  return null;
}
