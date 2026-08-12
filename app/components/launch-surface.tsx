"use client";

import { FileText, PenLine, Sparkles } from "lucide-react";
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

/**
 * Three ways in, for a screen that otherwise offers only a blank field.
 *
 * They fill the composer rather than sending: a suggestion is a starting
 * point, and firing a request the moment one is tapped takes the edit away
 * from the person who might have wanted to change a word first.
 */
type Suggestion = { label: string; prompt: string; tint: string; icon: ReactNode };

const SUGGESTIONS: Suggestion[] = [
  {
    label: "Explain something I paste in",
    prompt: "Explain this in plain language, and tell me what it leaves out:\n\n",
    tint: "var(--accent-primary)",
    icon: <Sparkles size={17} strokeWidth={1.9} />
  },
  {
    label: "Summarise a document I attach",
    prompt: "Summarise the attached document. Cite the page for anything specific.",
    tint: "var(--accent-info)",
    icon: <FileText size={17} strokeWidth={1.9} />
  },
  {
    label: "Draft a reply I can send",
    prompt: "Draft a reply to this. Keep it short and plain:\n\n",
    tint: "var(--accent-success)",
    icon: <PenLine size={17} strokeWidth={1.9} />
  }
];

export function LaunchSurface({
  online,
  name,
  onSuggestion,
  children
}: {
  online: boolean;
  name?: string;
  /** Fills the composer with the prompt. Omitted, the cards do not render. */
  onSuggestion?: (prompt: string) => void;
  children?: ReactNode;
}) {
  const [greeting, setGreeting] = useState("Good evening");
  const suggestions = onSuggestion ? SUGGESTIONS : [];

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

  return (
    <div className="navi-launch launch-surface flex min-h-full flex-col px-gutter pb-28 pt-6">
      {/* Left-aligned, not centred. The suggestions underneath are rows of
          text, and a centred heading above a stack of left-aligned rows gives
          the screen two competing edges. One edge, running down the left, is
          also where the eye already starts on a phone. */}
      <div className="mx-auto flex w-full max-w-app flex-1 flex-col justify-center">
        <h1 className="greeting-title flex items-center gap-3 pl-0.5 text-[1.75rem]/[2.125rem] text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-spark.png" alt="" aria-hidden="true" className="h-[30px] w-[30px] shrink-0" />
          {greeting}
        </h1>

        {!online ? (
          <p className="mt-4 max-w-[320px] text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
            You&apos;re offline. Saved chats stay available on this device.
          </p>
        ) : null}

        {suggestions.length ? (
          <div className="mt-6 flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => onSuggestion?.(suggestion.prompt)}
                className="flex min-h-14 w-full items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-surface px-4 text-left text-[0.90625rem]/[1.21875rem] font-medium text-primary active:scale-[.985] active:bg-elev-2"
              >
                <span className="shrink-0" style={{ color: suggestion.tint }} aria-hidden="true">{suggestion.icon}</span>
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* Setup guidance belongs with the greeting so it is on screen, not
            pushed below the fold by the centred layout. */}
        {children}
      </div>
    </div>
  );
}
