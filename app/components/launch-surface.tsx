"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Code2, FileText, Sparkles, SquarePen } from "lucide-react";

/

The greeting is a rotating copy line, not a clock label. Each time bucket

carries a handful of original lines and one is picked per launch, so the

launch screen never reads the same twice in a row. All copy is Navi's own.
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

/

Capitalise a name that arrived lowercase.
*/
function presentName(name: string): string {
return name.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

const SUGGESTIONS = [
{ icon: SquarePen, label: "Draft a document", prompt: "Draft a document outlining the key requirements for..." },
{ icon: Sparkles, label: "Brainstorm ideas", prompt: "Help me brainstorm some ideas for..." },
{ icon: FileText, label: "Summarize notes", prompt: "Can you summarize these notes into a concise bulleted list:\n\n" },
{ icon: Code2, label: "Write a script", prompt: "Write a script that will..." }
];

export function LaunchSurface({ online, name, children }: { online: boolean; name?: string; children?: ReactNode }) {
const [greeting, setGreeting] = useState("Good evening");

useEffect(() => {
if (name) {
const hour = new Date().getHours();
const part = hour < 5 ? "Late night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
setGreeting(${part}, ${presentName(name)});
return;
}
setGreeting(greetingForNow(new Date()));
}, [name]);

const handleSuggestion = (prompt: string) => {
const textarea = document.querySelector("textarea[data-navi-composer]");
if (textarea) {
const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
setter?.call(textarea, prompt);
textarea.dispatchEvent(new Event("input", { bubbles: true }));
window.setTimeout(() => {
textarea.focus();
textarea.setSelectionRange(prompt.length, prompt.length);
}, 60);
}
};

return (



    {/* Premium glowing brand orb */}
    <div className="brand-orb mb-5 flex h-20 w-20 items-center justify-center rounded-[24px] border border-[var(--border-subtle)] shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-spark.png" alt="" aria-hidden="true" className="h-11 w-11 shrink-0 drop-shadow-sm" />
    </div>

    <h1 className="greeting-title text-[2.25rem]/[2.5rem] font-normal tracking-[-0.03em] text-primary">
      {greeting}
    </h1>

    <p className="mt-2.5 max-w-[280px] text-[0.9375rem]/[1.375rem] font-medium text-tertiary">
      How can I help you today?
    </p>

    {/* Quick Actions Grid */}
    <div className="mt-10 grid w-full max-w-[420px] grid-cols-2 gap-3">
      {SUGGESTIONS.map((suggestion, index) => {
        const Icon = suggestion.icon;
        return (
          <button
            key={index}
            type="button"
            onClick={() => handleSuggestion(suggestion.prompt)}
            className="flex flex-col items-start gap-3 rounded-[20px] border border-[var(--border-subtle)] bg-elev-1 p-4 text-left transition-transform duration-[120ms] active:scale-95 active:bg-elev-2"
          >
            <span className="flex h-[36px] w-[36px] items-center justify-center rounded-[12px] bg-[var(--selection-bg)] text-accent">
              <Icon size={18} strokeWidth={2} />
            </span>
            <span className="text-[0.8125rem]/[1.125rem] font-semibold text-primary">
              {suggestion.label}
            </span>
          </button>
        );
      })}
    </div>

    {!online ? (
      <p className="mt-6 max-w-[320px] text-[0.875rem]/[1.3125rem] font-medium text-tertiary">
        You&apos;re offline. Saved chats stay available on this device.
      </p>
    ) : null}

    {/* Wraps any children (like ProviderSetupNotice) to maintain width */}
    <div className="mt-6 w-full max-w-[420px] text-left">
      {children}
    </div>
  </div>
</div>


);
}
