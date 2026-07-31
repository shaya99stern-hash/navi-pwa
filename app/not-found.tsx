import Link from "next/link";
import { NaviMark } from "./components/navi-mark";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-app px-6 text-primary">
      <section className="w-full max-w-sm text-center">
        <NaviMark className="mx-auto h-16 w-16 text-accent" />
        <h1 className="hero-title mt-6 text-[2.125rem]/[2.375rem] font-medium tracking-[-0.03em]">This page is not in NaviOS Hub</h1>
        <p className="mt-3 text-[0.875rem]/5 font-medium text-secondary">Return to the workspace without losing local conversations.</p>
        <Link href="/" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-[0.875rem]/5 font-semibold text-white active:bg-accent-pressed">Open NaviOS Hub</Link>
      </section>
    </main>
  );
}
