import { NaviMark } from "./components/navi-mark";

export default function Loading() {
  return (
    <main className="navi-page flex items-center justify-center" aria-label="Loading NaviOS">
      <div className="flex flex-col items-center gap-4">
        <NaviMark className="h-14 w-14 animate-pulse text-accent" />
        <div className="text-[0.8125rem]/5 font-semibold text-tertiary">Opening NaviOS…</div>
      </div>
    </main>
  );
}
