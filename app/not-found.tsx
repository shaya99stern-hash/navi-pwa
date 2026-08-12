import Link from "next/link";

export default function NotFound() {
  return (
    <main className="navi-page flex flex-col justify-center">
      <section className="mx-auto w-full max-w-[360px]">
        <div className="text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tertiary">404</div>
        <h1 className="hero-title mt-3.5 text-[1.875rem]/9 font-normal tracking-[-0.025em]">That page is not part of NaviOS</h1>
        <p className="mt-3 max-w-[32ch] text-[0.90625rem]/[1.40625rem] font-normal text-secondary">
          Nothing was lost. Your conversations are where you left them.
        </p>
        <Link
          href="/"
          className="mt-[22px] flex min-h-[50px] w-full items-center rounded-full bg-accent px-5 text-[0.9375rem]/[1.125rem] font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed"
        >
          Back to the workspace
        </Link>
      </section>
    </main>
  );
}
