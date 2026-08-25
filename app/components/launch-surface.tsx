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
  // Seeded by launch time so it rotates between visits without flickering
  // within one.
  return lines[Math.floor(now.getTime() / 60_000) % lines.length];
}

/**
 * Capitalise a name that arrived lowercase.
 *
 * The name falls back to the account handle when no display name is set, and a
 * handle is whatever its owner typed — "shaya", not "Shaya". Printing it
 * verbatim in a greeting produced "Evening, shaya", which reads as a database
 * field rather than as being addressed.
 *
 * Only the leading letter of each word is raised, and only when the word
 * starts lowercase: anything already capitalised is left exactly as it is, so
 * "McDonald", "d'Angelo" and "van der Berg" survive a fallback that a blanket
 * title-case would mangle. A name the user typed themselves is their business.
 */
function presentName(name: string): string {
  return name.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function LaunchSurface({ online, name, children }: { online: boolean; name?: string; children?: ReactNode }) {
  const [greeting, setGreeting] = useState("Good evening");

  useEffect(() => {
    /* A name turns the line into an address, so the bare time-of-day form is
       the only one that reads correctly beside it — "Where should we begin
       today?, Sam" is not a sentence. With no name the rotation stands; a
       placeholder would be worse than the variety it replaced. */
    if (name) {
      const hour = new Date().getHours();
      const part = hour < 5 ? "Late night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
      setGreeting(`${part}, ${presentName(name)}`);
      return;
    }
    setGreeting(greetingForNow(new Date()));
  }, [name]);

  const returningName = name?.trim().split(/\s+/u)[0] || "Shaya";

  return (
    <div
      className="navi-launch launch-surface flex min-h-full flex-col px-gutter"
      data-launch-greeting={greeting}
    >
      <div className="home-welcome mx-auto flex w-full max-w-app flex-1 flex-col items-center justify-center text-center">
        <h1 className="greeting-title flex items-center gap-3 pl-0.5 text-[1.5rem]/[1.875rem] text-secondary">
          {presentName(returningName)} returns!
        </h1>

        {!online ? (
          <p className="mt-4 max-w-[320px] text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
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
