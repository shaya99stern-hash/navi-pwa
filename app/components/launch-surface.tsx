"use client";

import { useEffect, useState, type ReactNode } from "react";

function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function LaunchSurface({ online, children }: { online: boolean; children?: ReactNode }) {
  const [greeting, setGreeting] = useState("Good evening");

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-28 pt-6">
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <h1 className="greeting-title flex items-center gap-3 text-[32px]/[38px] text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-spark.png" alt="" aria-hidden="true" className="h-9 w-9 shrink-0" />
          {greeting}
        </h1>

        {!online ? (
          <p className="mt-4 max-w-[320px] text-[14px]/[21px] font-medium text-tertiary">
            You&apos;re offline. Saved chats stay available on this device.
          </p>
        ) : null}

        {/* Setup guidance belongs with the greeting so it is on screen, not
            pushed below the fold by the centred layout. */}
        {children}
      </div>
    </div>
  );
}
