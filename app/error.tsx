"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Navi route error:", error);
  }, [error]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-app px-6 text-primary">
      <section className="w-full max-w-sm rounded-[28px] border border-[var(--border-subtle)] bg-elev-1 p-6 text-center shadow-composer">
        <div className="text-[22px]/7 font-semibold">Navi hit a temporary problem</div>
        <p className="mt-3 text-[14px]/5 font-medium text-secondary">Your local conversations and draft remain on this device.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px]/5 font-semibold text-white active:bg-accent-pressed">
          <RefreshCw size={17} /> Try again
        </button>
      </section>
    </main>
  );
}
