"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Navi route error:", error);
  }, [error]);

  return (
    <main className="navi-page flex flex-col justify-center">
      <section className="mx-auto w-full max-w-[360px]">
        <h1 className="hero-title text-[1.875rem]/9 font-normal tracking-[-0.025em]">NaviOS hit a temporary problem</h1>
        <p className="mt-3 max-w-[32ch] text-[0.90625rem]/[1.40625rem] font-normal text-secondary">
          Your local conversations and draft remain on this device.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-[22px] flex min-h-[50px] w-full items-center gap-2 rounded-full bg-accent px-5 text-[0.9375rem]/[1.125rem] font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed"
        >
          <RefreshCw size={17} /> Try again
        </button>
      </section>
    </main>
  );
}
