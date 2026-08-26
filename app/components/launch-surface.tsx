"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The greeting is a rotating copy line, not a clock label. Each time bucket
 * carries a handful of original lines and one is picked per launch, so the
 * launch screen never reads the same twice in a row. All copy is Navi's own.
 */
const GREETINGS: Record<"late" | "morning" | "afternoon" | "evening", string[]> = {
  late: [
    "Up late?",
    "The quiet hours are good for thinking.",
    "Night shift, reporting in.",
    "Still going strong."
  ],
  morning: [
    "Good morning",
    "Ready when you are.",
    "Fresh start, fresh thinking.",
    "Where should we begin today?"
  ],
  afternoon: [
    "Good afternoon",
    "Right in the thick of it.",
    "What's next on the list?",
    "Midday momentum."
  ],
  evening: [
    "Good evening",
    "Winding down or winding up?",
    "The evening is yours.",
    "One more thing before the day ends?"
  ]
};

function greetingForNow(now: Date): string {
  const hour = now.getHours();
  const bucket = hour < 5 ? "late" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const lines = GREETINGS[bucket];
  return lines[Math.floor(now.getTime() / 60_000) % lines.length];
}

function presentName(name: string): string {
  return name.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function LaunchSurface({ online, name, children }: { online: boolean; name?: string; children?: ReactNode }) {
  const [greeting, setGreeting] = useState("Good evening");

  useEffect(() => {
    if (name) {
      const hour = new Date().getHours();
      const part = hour < 5 ? "Late night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
      setGreeting(`${part}, ${presentName(name)}`);
      return;
    }
    setGreeting(greetingForNow(new Date()));
  }, [name]);

  const returningName = name?.trim().split(/\s+/u)[0];

  return (
    <div
      className="navi-launch launch-surface flex min-h-full flex-col px-gutter"
      data-launch-greeting={greeting}
    >
      <div className="home-welcome mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <h1 className="greeting-title flex items-center gap-3 pl-0.5 text-[1.5rem]/[1.875rem] text-secondary">
          {returningName ? `${presentName(returningName)} returns!` : "Welcome back"}
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
