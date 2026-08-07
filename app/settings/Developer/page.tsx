"use client";

import { ArrowLeft, Check, CloudUpload, FileCode2, GitBranch, LoaderCircle, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * The self-update engine, as a first-class screen.
 *
 * This page used to be unstyled scaffolding: three bare inputs and a blind
 * paste-to-commit button whose success read as an error because it looked for
 * a field the API never sent. It now reads the real file before editing it,
 * commits through the authenticated route, and reports the commit it made —
 * and it wears the same design language as the rest of the app.
 *
 * Entirely self-contained for a phone: the GitHub API is the editor's backend
 * and Vercel's GitHub integration is the deploy pipeline, so there is no
 * bridge server anywhere.
 */

type Status =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "committing" }
  | { phase: "error"; message: string }
  | { phase: "done"; message: string; url?: string };

export default function DeveloperSettings() {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });

  async function loadFile() {
    const target = path.trim();
    if (!target) {
      setStatus({ phase: "error", message: "Enter a repository path first, e.g. app/page.tsx." });
      return;
    }
    setStatus({ phase: "loading" });
    try {
      const response = await fetch(`/api/commit?path=${encodeURIComponent(target)}`, { cache: "no-store" });
      const data = (await response.json()) as { content?: string; error?: string };
      if (!response.ok || typeof data.content !== "string") throw new Error(data.error || "The file could not be read.");
      setContent(data.content);
      setLoaded(target);
      setStatus({ phase: "idle" });
    } catch (error) {
      setStatus({ phase: "error", message: error instanceof Error ? error.message : "The file could not be read." });
    }
  }

  async function commit() {
    const target = path.trim();
    if (!target || !content) {
      setStatus({ phase: "error", message: "A path and file content are both required." });
      return;
    }
    setStatus({ phase: "committing" });
    try {
      const response = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target, content, commitMessage: commitMessage.trim() })
      });
      const data = (await response.json()) as { success?: boolean; commitUrl?: string | null; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "The commit was rejected.");
      setStatus({
        phase: "done",
        message: "Committed. Vercel is deploying it now — the new version reaches this app in a couple of minutes.",
        url: data.commitUrl ?? undefined
      });
    } catch (error) {
      setStatus({ phase: "error", message: error instanceof Error ? error.message : "The commit failed." });
    }
  }

  const busy = status.phase === "loading" || status.phase === "committing";

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-app text-primary">
      <header className="safe-top flex min-h-[64px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-elev-1 px-3">
        <Link href="/settings" className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Back to settings"><ArrowLeft size={21} /></Link>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.0625rem]/6 font-semibold text-primary">Developer</span>
          <span className="block text-[0.6875rem]/4 font-medium text-tertiary">Self-update engine · commits deploy automatically</span>
        </span>
      </header>

      <main className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 pb-[calc(24px+var(--safe-bottom))] pt-4">
          <section className="rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent"><Rocket size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">How self-update works</h2>
                <p className="mt-1 text-[0.75rem]/[1.125rem] font-medium text-secondary">
                  Edits commit straight to the app&apos;s own GitHub repository, and every commit triggers a Vercel
                  deployment — so a change made here becomes the running app within minutes. You can also just ask
                  NaviSoul in Code mode: with GitHub connected it reads, edits, and commits the codebase itself.
                </p>
              </span>
            </div>
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-elev-2 text-secondary"><FileCode2 size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Edit a file</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Load the current version first, so you edit what is really there.</p>
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="app/page.tsx"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-elev-2 px-3 font-mono text-[0.8125rem]/5 text-primary outline-none placeholder:text-tertiary focus:border-accent"
              />
              <button type="button" onClick={() => void loadFile()} disabled={busy} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-elev-2 px-4 text-[0.8125rem]/5 font-semibold text-primary active:bg-elev-3 disabled:opacity-60">
                {status.phase === "loading" ? <LoaderCircle size={16} className="animate-spin" /> : null}Load
              </button>
            </div>

            {loaded ? (
              <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem]/4 font-medium text-tertiary"><GitBranch size={13} className="shrink-0" />Editing {loaded} from the default branch.</p>
            ) : null}

            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={14}
              placeholder="Load a file, or paste new file content here…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-3 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-elev-2 p-3 font-mono text-[0.75rem]/[1.125rem] text-primary outline-none placeholder:text-tertiary focus:border-accent"
            />

            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit message"
              className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-elev-2 px-3 text-[0.875rem]/5 text-primary outline-none placeholder:text-tertiary focus:border-accent"
            />

            <button type="button" onClick={() => void commit()} disabled={busy} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[0.875rem]/5 font-semibold text-white active:bg-accent-pressed disabled:opacity-60">
              {status.phase === "committing" ? <><LoaderCircle size={17} className="animate-spin" />Committing…</> : <><CloudUpload size={17} />Commit and deploy</>}
            </button>

            {status.phase === "error" ? (
              <div className="mt-3 flex gap-2 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.75rem]/[1.125rem] font-medium text-danger"><TriangleAlert size={16} className="shrink-0" />{status.message}</div>
            ) : null}
            {status.phase === "done" ? (
              <div className="mt-3 flex gap-2 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[0.75rem]/[1.125rem] font-medium text-primary">
                <Check size={16} className="shrink-0 text-accent" />
                <span>{status.message}{status.url ? <> <a href={status.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent">View the commit.</a></> : null}</span>
              </div>
            ) : null}
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex gap-3">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h2 className="text-[0.875rem]/5 font-semibold text-primary">Guardrails</h2>
                <p className="mt-1 text-[0.75rem]/5 font-medium text-secondary">
                  Commits require your signed-in session — this screen and its API refuse anonymous callers. Paths are
                  confined to the repository, and every change is an ordinary Git commit: visible in history, revertible
                  with one click on GitHub.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
