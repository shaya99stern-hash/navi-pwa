"use client";

import { useEffect, useState } from "react";
import { InstallButton } from "./install-button";

function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function LaunchSurface({
  online,
  haptics
}: {
  online: boolean;
  haptics: boolean;
}) {
  const [greeting, setGreeting] = useState("Good evening");

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-28 pt-6">
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <h1 className="greeting-title flex items-center gap-3 text-[32px]/[38px] text-primary">
          <span aria-hidden="true" className="text-[26px] text-accent">✳</span>
          {greeting}
        </h1>

        {!online ? (
          <p className="mt-4 max-w-[320px] text-[14px]/[21px] font-medium text-tertiary">
            You&apos;re offline. Saved chats stay available on this device.
          </p>
        ) : null}

        <div className="absolute bottom-[132px] left-0 right-0 flex justify-center">
          <InstallButton haptics={haptics} />
        </div>
      </div>
    </div>
  );
}
