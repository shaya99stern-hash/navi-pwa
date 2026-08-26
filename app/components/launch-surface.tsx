"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NaviMark } from "./navi-mark";

function presentName(name: string): string {
  return name.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

function greetingForNow(name?: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = name?.trim().split(/\s+/u)[0];
  return firstName ? `${part}, ${presentName(firstName)}` : part;
}

export function LaunchSurface({ online, name, children }: { online: boolean; name?: string; children?: ReactNode }) {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    setGreeting(greetingForNow(name));
  }, [name]);

  return (
    <div
      className="navi-launch launch-surface flex min-h-full flex-col px-gutter"
      data-launch-greeting={greeting}
    >
      <div className="home-welcome mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <NaviMark className="home-welcome-mark mb-3 h-7 w-7 object-contain" label="NaviOS" />
        <h1 className="greeting-title pl-0.5 text-[1.5rem]/[1.875rem] text-secondary">
          {greeting}
        </h1>

        {!online ? (
          <p className="mt-4 max-w-[320px] text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
            You&apos;re offline. Saved chats stay available on this device.
          </p>
        ) : null}

        {children}
      </div>
    </div>
  );
}
