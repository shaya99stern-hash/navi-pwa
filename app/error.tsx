"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Navi route error:", error);

    /* Put the address bar back where the person was.
       Sheets are real routes here — opening Settings pushes `/settings`, and
       closing it pops back. So a crash while any sheet is open strands the URL
       on that sheet's path, and recovering then lands on Settings rather than
       on the conversation. Reported exactly that way: "it glitches and goes to
       settings screen".

       `replaceState` rather than a navigation: the render already failed, and
       asking the router to move during that is how one broken screen becomes
       two. This only corrects the address so `Try again` returns somewhere
       sensible. */
    if (typeof window === "undefined") return;
    const stranded = (window.history.state as { naviOverlay?: unknown } | null)?.naviOverlay;
    if (!stranded) return;
    try {
      window.history.replaceState({ ...window.history.state, naviOverlay: null }, "", "/");
    } catch {
      /* A history API that refuses leaves the URL as it was, which is the
         behaviour without this. Never make an error page throw. */
    }
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
