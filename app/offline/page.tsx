import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = {
  title: "Offline",
  robots: { index: false, follow: false }
};

export default function OfflinePage() {
  return (
    <main className="navi-page flex flex-col justify-center">
      <section className="mx-auto w-full max-w-[360px]">
        <span className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--accent-danger)_14%,transparent)]">
          <WifiOff size={22} strokeWidth={1.9} className="text-danger" />
        </span>
        <h1 className="hero-title mt-5 text-[1.875rem]/9 font-normal tracking-[-0.025em]">No network</h1>
        <p className="mt-3 max-w-[32ch] text-[0.90625rem]/[1.40625rem] font-normal text-secondary">
          Your conversations, files and draft are on this device and open as normal. Sending resumes when the network does.
        </p>
        <div className="mt-[22px] rounded-[16px] border border-[var(--border-subtle)] bg-surface p-3.5">
          <div className="text-[0.78125rem]/[1.015rem] font-semibold text-primary">Still available offline</div>
          <div className="mt-2 text-[0.8125rem]/[1.38rem] font-normal text-secondary">
            Every saved conversation, every file you have attached, and every slash command.
          </div>
        </div>
        <Link
          href="/"
          className="mt-5 flex min-h-[50px] w-full items-center rounded-full bg-accent px-5 text-[0.9375rem]/[1.125rem] font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed"
        >
          Open local workspace
        </Link>
      </section>
    </main>
  );
}
