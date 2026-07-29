import { NaviMark } from "./components/navi-mark";

export default function Loading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-app text-primary" aria-label="Loading NaviOS Hub">
      <div className="flex flex-col items-center gap-4">
        <NaviMark className="h-14 w-14 animate-pulse text-accent" />
        <div className="text-[13px]/5 font-semibold text-tertiary">Opening NaviOS Hub…</div>
      </div>
    </main>
  );
}
