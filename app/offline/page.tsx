import Link from "next/link";
import { WifiOff } from "lucide-react";
import { NaviMark } from "../components/navi-mark";

export const metadata = {
  title: "Offline",
  robots: { index: false, follow: false }
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-app px-6 text-primary"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>
      <section className="w-full max-w-sm rounded-[28px] border border-[var(--border-subtle)] bg-elev-1 p-7 text-center shadow-composer">
        <NaviMark className="mx-auto h-16 w-16 text-accent" />
        <div className="mt-5 flex items-center justify-center gap-2 text-[22px]/7 font-semibold"><WifiOff size={21} /> NaviOS Hub is offline</div>
        <p className="mt-3 text-[14px]/[21px] font-medium text-secondary">Your saved conversations and draft remain on this device. Sending and external connections resume when the network returns.</p>
        <Link href="/" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-[14px]/5 font-semibold text-white active:bg-accent-pressed">Open local workspace</Link>
      </section>
    </main>
  );
}
