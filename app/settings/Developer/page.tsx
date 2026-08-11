"use client";

import { ArrowLeft, Check, CloudUpload, FileCode2, GitBranch, KeyRound, LoaderCircle, MessageSquare, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

type Capability = { id: string; name: string; ready: boolean; detail: string };

export default function DeveloperSettings() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  /* What is actually switched on in this deployment. Navi Soul has told this
     user it has no code sandbox, invented a SHOW_DEVELOPER flag, and named
     credentials that do not exist — all answerable from here. */
  const [capabilities, setCapabilities] = useState<{ loaded: boolean; items: Capability[] }>({ loaded: false, items: [] });
  const [askDraft, setAskDraft] = useState("");

  /**
   * Hand the request to Navi Soul in Code mode.
   *
   * The prompt is shaped rather than passed through: "read the file first,
   * change the smallest thing that works, say what you changed" is the
   * difference between a considered edit and a confident rewrite of a file it
   * never opened — which is the failure mode that breaks an app.
   */
  function askNaviSoul() {
    const request = askDraft.trim();
    if (!request) return;
    const framed = [
      request,
      "",
      "Change NaviOS's own codebase for this. Find and read the real files first, make the smallest change that fully solves it, then commit it and tell me plainly what you changed and why. If you are not confident it is right, show me the change instead of committing it."
    ].join("\n");
    /* `text` is the parameter /new actually reads — it is the OS share-sheet
       contract, reused here. The request names the repository tools, so the
       self-update group switches on regardless of the current mode. */
    router.push(`/new?text=${encodeURIComponent(framed)}`);
  }

  useEffect(() => {
    void fetch("/api/system/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { capabilities?: Capability[] } | null) => {
        setCapabilities({ loaded: true, items: Array.isArray(data?.capabilities) ? data.capabilities : [] });
      })
      .catch(() => setCapabilities({ loaded: true, items: [] }));
  }, []);

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
                  Navi Soul in Code mode: with GitHub connected it reads, edits, and commits the codebase itself.
                </p>
              </span>
            </div>
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-elev-2 text-secondary"><ShieldCheck size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Engine capabilities</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">
                  What is switched on in this deployment, read from the server. Each row names the variable it needs — never its value.
                </p>
              </span>
            </div>
            <div className="mt-3 divide-y divide-[var(--border-subtle)]">
              {!capabilities.loaded ? (
                <p className="py-4 text-[0.8125rem]/5 font-medium text-secondary">Checking…</p>
              ) : !capabilities.items.length ? (
                <p className="py-4 text-[0.8125rem]/5 font-medium text-secondary">Capability status could not be read.</p>
              ) : capabilities.items.map((capability) => (
                <div key={capability.id} className="flex gap-3 py-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${capability.ready ? "bg-[var(--selection-bg)] text-accent" : "bg-elev-2 text-tertiary"}`}>
                    {capability.ready ? <Check size={14} /> : <TriangleAlert size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.875rem]/5 font-semibold text-primary">{capability.name}</span>
                    <span className="block text-[0.6875rem]/[1rem] font-medium text-tertiary">{capability.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* The ordinary way to change the app: say what you want.
              Pasting whole files was the only route, which meant writing the
              code yourself before the self-update engine could apply it —
              exactly backwards for an assistant that can read the repository
              and write the change itself. The editor below stays for the
              times you want to drive it by hand. */}
          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent"><MessageSquare size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Just describe the change</h2>
                <p className="mt-1 text-[0.75rem]/[1.125rem] font-medium text-secondary">
                  Say what you want changed in your own words. Navi Soul reads the real files, works out what to edit,
                  makes the change, and commits it — the same way you would ask a developer.
                </p>
              </span>
            </div>

            <textarea
              value={askDraft}
              onChange={(event) => setAskDraft(event.target.value)}
              rows={3}
              placeholder="e.g. Make the send button bigger on phones, or move the research toggle next to the mic"
              className="mt-3 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[0.875rem]/[1.25rem] text-primary outline-none placeholder:text-tertiary focus:border-accent"
            />
            <button
              type="button"
              onClick={askNaviSoul}
              disabled={!askDraft.trim()}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[0.875rem]/5 font-semibold text-white active:bg-accent-pressed disabled:opacity-60"
            >
              <Rocket size={17} />Ask Navi Soul to make this change
            </button>
            <p className="mt-2 text-[0.6875rem]/4 font-medium text-tertiary">
              Opens a Code-mode chat with your request. Navi Soul will read the files before editing, and tell you what it changed.
            </p>
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

          {/* The deployment variables, gathered here.
              These sentences used to sit on the Connectors screen, where they
              told someone holding a phone to open a Vercel dashboard and
              redeploy — an instruction a consumer surface cannot act on and
              should not carry. They are real and worth keeping, so they moved
              to the one screen whose audience can use them rather than being
              deleted. */}
          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-elev-2 text-secondary"><KeyRound size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Deployment settings</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">
                  Set these in the hosting project&apos;s environment, then redeploy. They apply to everyone using this
                  deployment, not to one account.
                </p>
              </span>
            </div>
            <dl className="mt-3 space-y-3">
              {[
                ["GOOGLE_OAUTH_CLIENT_ID / _SECRET", "Lets each person connect their own Gmail and Calendar. See docs/google-connector-setup.md."],
                ["GITHUB_OAUTH_CLIENT_ID / _SECRET", "Lets each person connect their own GitHub. This must be a separate OAuth app from the one Clerk uses for sign-in — one OAuth app holds one callback URL."],
                ["NAVI_GITHUB_ALLOW_WRITES", "Set to true to let Navi Soul commit to a working branch and open pull requests. Off by default; reconnect GitHub after changing it."],
                ["NAVI_VERCEL_TOKEN", "Deployment and build-log reads. Configured once for the whole deployment rather than per person; scope it to the team that owns this project."],
                ["MCP_SERVER_REGISTRY_JSON", "The connector servers this deployment offers. Their credentials stay on the server and never reach the browser."],
                ["HF_TOKEN", "Voice transcription, image and audio generation. Needs the “Make calls to Inference Providers” permission."]
              ].map(([name, detail]) => (
                <div key={name} className="rounded-xl bg-elev-2 p-3">
                  <dt className="font-mono text-[0.75rem]/4 font-semibold text-primary">{name}</dt>
                  <dd className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">{detail}</dd>
                </div>
              ))}
            </dl>
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
