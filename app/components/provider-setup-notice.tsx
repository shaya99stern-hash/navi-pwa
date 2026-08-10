"use client";

import { KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { haptic } from "@/lib/ui/haptics";
import { readProviderStatus, watchProviderStatus, type ProviderStatus } from "@/lib/ui/provider-status";

const KEY_NAMES: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  huggingface: "HF_TOKEN"
};

/**
 * Shown only when the server reports that no model credential is configured.
 * Without one the app can hold a conversation draft but cannot generate a
 * reply, so the state is stated plainly instead of failing at send time.
 */
export function ProviderSetupNotice({ haptics }: { haptics: boolean }) {
  const [missing, setMissing] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);

  /* A failed probe is not "nothing is configured" — it is "we do not know" —
     so an unknown answer hides the notice rather than accusing the deployment
     of being unconfigured. */
  const apply = useCallback((data: ProviderStatus | null) => {
    // Any provider at all is enough to answer; the notice is about none.
    const anyReady = Object.values(data?.providers ?? {}).some(Boolean);
    setMissing(!data || anyReady ? null : Object.keys(KEY_NAMES));
  }, []);

  /* The user asking is the one case that must not be served from cache: they
     tapped Check again precisely because they just changed something. */
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      apply(await readProviderStatus({ force: true }));
    } finally {
      setChecking(false);
    }
  }, [apply]);

  useEffect(() => watchProviderStatus(apply), [apply]);

  if (!missing) return null;

  return (
    <section
      className="mx-auto mt-6 w-full max-w-app rounded-card border border-[var(--border-strong)] bg-elev-2 p-4 text-left"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent">
          <KeyRound size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem]/[1.375rem] font-semibold text-primary">Finish setup to start chatting</h2>
          <p className="mt-1 text-[0.8125rem]/[1.1875rem] font-medium text-secondary">
            No model credential is configured, so replies cannot be generated yet. Add at least one of these as an
            environment variable in your Vercel project, then redeploy.
          </p>
          <ul className="mt-3 space-y-1">
            {missing.map((provider) => (
              <li key={provider} className="flex items-center gap-2 text-[0.75rem]/4">
                <code className="rounded-md border border-[var(--border-subtle)] bg-elev-1 px-1.5 py-0.5 font-semibold text-primary">
                  {KEY_NAMES[provider]}
                </code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.6875rem]/4 font-medium text-tertiary">
            Vercel → Project Settings → Environment Variables → Production. Everything else in the app works now;
            drafts, chats, and projects stay on this device.
          </p>
          <button
            type="button"
            onClick={() => {
              haptic("selection", haptics);
              void recheck();
            }}
            disabled={checking}
            className="mt-3 flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-[0.8125rem]/5 font-semibold text-[var(--accent-on-primary)] transition-transform duration-[120ms] active:scale-95 active:bg-accent-pressed disabled:opacity-70"
          >
            {checking ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
    </section>
  );
}
