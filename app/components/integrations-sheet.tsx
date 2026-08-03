"use client";

import { Check, ChevronRight, Github, Link2, Search, Triangle, X } from "lucide-react";
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

function Row({ icon, title, detail, connected, action, onAction }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  /** Undefined means not yet known, which must not be shown as disconnected. */
  connected: boolean | undefined;
  action?: string;
  onAction?: () => void;
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
            <div className="text-[0.75rem]/4 font-medium text-tertiary">What Navi can reach outside this app</div>
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
                    ? "Navi can read your repositories, files, pull requests, and CI runs. Read-only — it cannot push or merge."
                    : "Add NAVI_GITHUB_TOKEN in Vercel, then redeploy. A fine-grained token with Contents, Metadata, Pull requests, and Actions set to Read."
              }
            />
            <Row
              icon={<Triangle size={17} strokeWidth={1.8} />}
              title="Vercel"
              connected={known ? status.vercel : undefined}
              detail={
                !known ? "Checking…"
                  : status.vercel
                    ? "Navi can read your deployments and build logs. Read-only — it cannot deploy or change settings."
                    : "Add NAVI_VERCEL_TOKEN in Vercel, then redeploy. Scope it to the team that owns this project."
              }
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
                  : "Connect a remote MCP server over HTTPS to give Navi access to your own tools and data."
              }
              action="Manage"
              onAction={onOpenConnectors}
            />
          </div>

          <p className="px-2 pt-3 text-[0.75rem]/[1.125rem] text-tertiary">
            Repository and deployment access is read-only by construction: Navi can list, read, and
            search, but has no tool that writes. Adding a key takes effect on the next deploy — a
            running deployment does not pick it up.
          </p>
        </div>
      </section>
    </div>
  );
}
