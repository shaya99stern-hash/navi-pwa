"use client";

import { Check, ChevronRight, Cpu, Github, Link2, Search, Triangle, X } from "lucide-react";
import { useState } from "react";
import type { ConnectorAccessMode } from "@/lib/ai/types";
import { useSheetDrag } from "@/lib/ui/use-sheet-drag";

/**
 * Everything Navi can reach outside itself, in one place.
 *
 * The rule this exists to enforce: no integration gets its own icon on the
 * main interface. A row of loose buttons is how an app accumulates surface
 * nobody can name — and on a phone there is no room for it. Each integration
 * is a row here, reachable from the composer's plus menu, and nowhere else.
 *
 * Every row reports its real state, read from the server rather than assumed.
 * An integration that is switched on but unconfigured looks identical to a
 * working one right up until an answer quietly comes from memory, which is the
 * failure this screen is meant to make impossible.
 */

export type IntegrationStatus = {
  github: boolean;
  vercel: boolean;
  search: { configured: boolean; provider: string | null };
  /** Null while the probe is in flight — genuinely unknown, not "off". */
  loaded: boolean;
};

type Props = {
  open: boolean;
  status: IntegrationStatus;
  connectorCount: number;
  connectorAccessMode: ConnectorAccessMode;
  haptics: boolean;
  onClose: () => void;
  onOpenConnectors: () => void;
};

const SEARCH_LABEL: Record<string, string> = {
  tavily: "Tavily",
  exa: "Exa",
  brave: "Brave Search"
};

type TestState = { phase: "idle" | "testing" | "ok" | "failed"; message: string };

function Row({ icon, title, detail, connected, action, onAction, test, onTest }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  /** Undefined means not yet known, which must not be shown as disconnected. */
  connected: boolean | undefined;
  action?: string;
  onAction?: () => void;
  test?: TestState;
  onTest?: () => void;
}) {
  const body = (
    <>
      <span className="mt-0.5 shrink-0 text-secondary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[0.9375rem]/5 font-semibold text-primary">{title}</span>
          {connected === undefined ? null : connected ? (
            <Check size={15} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Connected" />
          ) : (
            <span className="shrink-0 rounded-full bg-elev-3 px-1.5 py-0.5 text-[0.625rem]/3 font-semibold uppercase tracking-[0.08em] text-tertiary">
              Off
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[0.8125rem]/[1.125rem] text-tertiary">{detail}</span>
        {test && test.phase !== "idle" ? (
          <span className={`mt-1.5 block text-[0.8125rem]/[1.125rem] font-medium ${test.phase === "failed" ? "text-danger" : test.phase === "ok" ? "text-accent" : "text-secondary"}`}>
            {test.message}
          </span>
        ) : null}
        {onTest ? (
          /* Nested inside the row rather than beside it: on a phone a second
             control on the same line is a mis-tap waiting to happen. */
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => { event.stopPropagation(); onTest(); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onTest(); } }}
            className="mt-2 inline-flex min-h-9 items-center rounded-full border border-[var(--border-subtle)] px-3 text-[0.8125rem]/5 font-medium text-primary active:bg-elev-3"
          >
            {test?.phase === "testing" ? "Testing…" : "Test connection"}
          </span>
        ) : null}
      </span>
    </>
  );

  if (action && onAction) {
    return (
      <button type="button" onClick={onAction} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-elev-3">
        {body}
        {/* A tappable row needs to look tappable. Without this it was
            indistinguishable from the three rows that only report state. */}
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[0.8125rem]/5 font-medium text-tertiary">
          {action}
          <ChevronRight size={15} strokeWidth={2} />
        </span>
      </button>
    );
  }
  return <div className="flex items-start gap-3 px-4 py-3">{body}</div>;
}

export function IntegrationsSheet({
  open,
  status,
  connectorCount,
  connectorAccessMode,
  haptics,
  onClose,
  onOpenConnectors
}: Props) {
  const sheet = useSheetDrag({ open, onDismiss: onClose, haptics });
  const [tests, setTests] = useState<Record<"github" | "vercel", TestState>>({
    github: { phase: "idle", message: "" },
    vercel: { phase: "idle", message: "" }
  });

  const [providerReport, setProviderReport] = useState<{
    phase: "idle" | "testing" | "done" | "error";
    message: string;
    rows: Array<{ label: string; ok: boolean; status?: number; detail?: string }>;
  }>({ phase: "idle", message: "", rows: [] });

  const runProviderTest = async () => {
    setProviderReport({ phase: "testing", message: "Testing every configured provider…", rows: [] });
    try {
      const response = await fetch("/api/integrations/test?target=providers", { method: "POST", cache: "no-store" });
      const data = await response.json() as {
        results?: Array<{ label: string; ok: boolean; status?: number; detail?: string }>;
        working?: number; total?: number;
      };
      const rows = data.results ?? [];
      if (!rows.length) {
        setProviderReport({ phase: "error", message: "No AI provider keys are configured at all.", rows: [] });
        return;
      }
      setProviderReport({
        phase: data.working ? "done" : "error",
        message: `${data.working} of ${data.total} providers answered.`,
        rows
      });
    } catch {
      setProviderReport({ phase: "error", message: "The test could not run.", rows: [] });
    }
  };

  const runTest = async (target: "github" | "vercel") => {
    setTests((current) => ({ ...current, [target]: { phase: "testing", message: "" } }));
    try {
      const response = await fetch(`/api/integrations/test?target=${target}`, { method: "POST", cache: "no-store" });
      const data = await response.json() as { ok?: boolean; identity?: string; error?: string };
      setTests((current) => ({
        ...current,
        [target]: data.ok
          /* Naming the account is the whole point: "connected" was never the
             question, "connected as whom" was. */
          ? { phase: "ok", message: `Connected as ${data.identity}.` }
          : { phase: "failed", message: data.error ?? "The connection could not be verified." }
      }));
    } catch {
      setTests((current) => ({ ...current, [target]: { phase: "failed", message: "The test could not run." } }));
    }
  };

  if (!open) return null;

  const known = status.loaded;
  const searchName = status.search.provider ? SEARCH_LABEL[status.search.provider] ?? status.search.provider : null;

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <button type="button" aria-label="Close integrations" onClick={onClose} {...sheet.scrimProps} className="absolute inset-0 bg-overlay backdrop-blur-[3px]" />
      <section
        {...sheet.sheetProps}
        role="dialog"
        aria-modal="true"
        aria-label="Integrations"
        className="navi-sheet relative mx-auto flex max-h-[82dvh] w-full max-w-[480px] flex-col overflow-hidden pb-[calc(16px+var(--safe-bottom))]"
      >
        <div {...sheet.handleProps} className="navi-sheet-grab shrink-0 pt-1"><div className="navi-sheet-grabber" /></div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-1">
          <div>
            <div className="text-[1.0625rem]/6 font-semibold text-primary">Integrations</div>
            <div className="text-[0.75rem]/4 font-medium text-tertiary">What NaviSol can reach outside this app</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-secondary active:bg-elev-3"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          <div className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-elev-2">
            <Row
              icon={<Github size={19} strokeWidth={1.8} />}
              title="GitHub"
              connected={known ? status.github : undefined}
              detail={
                !known ? "Checking…"
                  : status.github
                    ? "NaviSol can read your repositories, files, pull requests, and CI runs. Read-only — it cannot push or merge."
                    : "Add NAVI_GITHUB_TOKEN in Vercel, then redeploy. A fine-grained token with Contents, Metadata, Pull requests, and Actions set to Read."
              }
              test={tests.github}
              onTest={() => void runTest("github")}
            />
            <Row
              icon={<Triangle size={17} strokeWidth={1.8} />}
              title="Vercel"
              connected={known ? status.vercel : undefined}
              detail={
                !known ? "Checking…"
                  : status.vercel
                    ? "NaviSol can read your deployments and build logs. Read-only — it cannot deploy or change settings."
                    : "Add NAVI_VERCEL_TOKEN in Vercel, then redeploy. Scope it to the team that owns this project."
              }
              test={tests.vercel}
              onTest={() => void runTest("vercel")}
            />
            <Row
              icon={<Search size={19} strokeWidth={1.8} />}
              title="Web search"
              connected={known ? status.search.configured : undefined}
              detail={
                !known ? "Checking…"
                  : searchName
                    ? `Live results through ${searchName}. Turn Research mode on to use it for a message.`
                    : "Research mode has nothing to search with. Add EXA_API_KEY, TAVILY_API_KEY, or BRAVE_SEARCH_API_KEY in Vercel, then redeploy."
              }
            />
            <Row
              icon={<Link2 size={19} strokeWidth={1.8} />}
              title="Connectors"
              connected={connectorCount > 0}
              detail={
                connectorCount
                  ? `${connectorCount} connected · access is ${connectorAccessMode === "ask" ? "asked for each chat" : connectorAccessMode}`
                  : "Connect a remote MCP server over HTTPS to give NaviSol access to your own tools and data."
              }
              action="Manage"
              onAction={onOpenConnectors}
            />
          </div>

          {/* The AI providers are the app's engine, and until now nothing
              reported on them individually. A chat failure names whichever
              attempt failed last, which with a fallback chain hides the first
              two — so "every provider refused" and "one provider refused"
              looked identical. */}
          <div className="mt-3 overflow-hidden rounded-card border border-[var(--border-subtle)] bg-elev-2">
            <div className="flex items-start gap-3 px-4 py-3">
              <Cpu size={19} strokeWidth={1.8} className="mt-0.5 shrink-0 text-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem]/5 font-semibold text-primary">AI providers</span>
                <span className="mt-0.5 block text-[0.8125rem]/[1.125rem] text-tertiary">
                  Checks each configured key against its provider and reports what each one says.
                </span>
                {providerReport.message ? (
                  <span className={`mt-1.5 block text-[0.8125rem]/[1.125rem] font-medium ${providerReport.phase === "error" ? "text-danger" : providerReport.phase === "done" ? "text-accent" : "text-secondary"}`}>
                    {providerReport.message}
                  </span>
                ) : null}
                {providerReport.rows.length ? (
                  <span className="mt-2 block space-y-1.5">
                    {providerReport.rows.map((row) => (
                      <span key={row.label} className="block text-[0.75rem]/[1.125rem]">
                        <span className={row.ok ? "font-semibold text-accent" : "font-semibold text-danger"}>
                          {row.ok ? "OK" : row.status ? String(row.status) : "ERR"}
                        </span>
                        <span className="text-secondary"> {row.label}</span>
                        {row.detail ? <span className="text-tertiary"> — {row.detail}</span> : null}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => void runProviderTest()}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void runProviderTest(); } }}
                  className="mt-2 inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] px-3 text-[0.8125rem]/5 font-medium text-primary active:bg-elev-3"
                >
                  {providerReport.phase === "testing" ? "Testing…" : "Test AI providers"}
                </span>
              </span>
            </div>
          </div>

          <p className="px-2 pt-3 text-[0.75rem]/[1.125rem] text-tertiary">
            A tick means a token is present. <span className="text-secondary">Test connection</span> is
            the stronger claim: it calls the service and names the account that answered, so an expired
            or wrongly-scoped token cannot pass as working. Access is read-only by construction — NaviSol
            can list, read, and search, but has no tool that writes. Adding a key takes effect on the
            next deploy; a running deployment does not pick it up.
          </p>
        </div>
      </section>
    </div>
  );
}
