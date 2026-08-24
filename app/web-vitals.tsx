"use client";

import { useMemo } from "react";
import { useReportWebVitals } from "next/web-vitals";

/**
 * How often a page load reports its vitals at all.
 *
 * Every load used to report all five, which came to 111 edge invocations in a
 * week for a console line nobody reads. The numbers themselves are healthy and
 * have been for months — LCP around 100–270ms, TTFB 36–147ms, INP 16ms — so
 * the value of the next reading is watching for a regression, not measuring
 * something unknown.
 *
 * Sampled by *page load* rather than by metric on purpose. The five vitals
 * from one load describe one experience: an LCP is only interesting beside the
 * TTFB that preceded it. Rolling the dice per metric would keep a tenth of the
 * readings and lose every pairing, which is the part that would actually
 * explain a regression.
 */
const REPORT_ONE_LOAD_IN = 10;

export default function WebVitals() {
  /* Decided once, when the page mounts, so the whole load agrees with itself.
     Inside the callback this would re-roll on every metric and defeat the
     point. */
  const reporting = useMemo(() => Math.random() < 1 / REPORT_ONE_LOAD_IN, []);

  useReportWebVitals((metric) => {
    if (!reporting) return;
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
