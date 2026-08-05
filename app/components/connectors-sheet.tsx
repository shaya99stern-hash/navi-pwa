"use client";

import { AlertTriangle, Check, Link2, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ConnectorAccessMode, NaviPreferences } from "@/lib/ai/types";
import type { PublicMcpServer } from "@/lib/mcp";
import { haptic } from "@/lib/ui/haptics";

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  haptics: boolean;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
};

const MODES: Array<{ id: ConnectorAccessMode; title: string; detail: string }> = [
  { id: "ask", title: "Ask every time", detail: "NaviSoul may inspect connector availability, but external access waits for your approval." },
  { id: "auto", title: "Auto for reads", detail: "Read-only resources may be used automatically. Writes, deletes, sends, bookings, and purchases still require approval." },
  { id: "always", title: "Always available", detail: "Connected read-only resources stay available in this conversation. Sensitive actions still require explicit confirmation." }
];

/**
 * The first-party accounts, in the same place as everything else you connect.
 *
 * These used to live only under Settings → Capabilities → Developer, while this
 * sheet listed the MCP registry — so a connected GitHub was invisible from the
 * screen called Connectors, and an empty registry read as "nothing is
 * connected" when two things were. They are different mechanisms underneath;
 * that is not a reason to make someone learn which is which to find them.
 */
type AccountConnector = {
  id: "github" | "google" | "vercel";
  name: string;
  detail: string;
  /** Absent for accounts the deployment configures with a token rather than OAuth. */
  connectPath?: string;
  statusPath?: string;
  /** What is missing, when this cannot be connected from the phone. */
  setup?: string;
  /** What the connection permits, stated rather than left to be guessed. */
  reads: string;
  writes?: string;
};

const ACCOUNTS: AccountConnector[] = [
  {
    id: "google",
    name: "Google",
    detail: "Gmail and Calendar",
    connectPath: "/api/google/oauth/start",
    statusPath: "/api/google/status",
    /* "Not configured" with no way forward is a dead end. Connecting needs
       credentials that only exist in the deployment, so say which ones. */
    setup: "Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel. See docs/google-connector-setup.md.",
    reads: "Read your mail and calendar",
    writes: "Send mail and create events"
  },
  {
    id: "github",
    name: "GitHub",
    detail: "Repositories, pull requests, and CI logs",
    connectPath: "/api/github/oauth/start",
    statusPath: "/api/github/status",
    setup: "Needs GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET in Vercel.",
    reads: "Read repositories, pull requests, and CI logs",
    writes: "Commit to a working branch and open pull requests"
  },
  {
    id: "vercel",
    name: "Vercel",
    detail: "Deployments and build logs",
    /* No status route and no Connect button: this one is configured with a
       deployment-wide token rather than per user, so there is nothing for an
       individual to authorize. Saying so beats an inert row. */
    setup: "Configured for the whole deployment with NAVI_VERCEL_TOKEN, not per person.",
    reads: "Read deployments and build logs"
  }
];

type AccountStatus = {
  connected: boolean;
  label: string | null;
  oauthAvailable: boolean;
  writesEnabled: boolean;
};

function Switch({ value, label, onChange }: { value: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${value ? "bg-accent" : "bg-elev-3"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export function ConnectorsSheet({ open, preferences, haptics, onClose, onPreferences }: Props) {
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});

  async function refreshAccounts() {
    const entries = await Promise.all(ACCOUNTS.map(async (account) => {
      if (!account.statusPath) return [account.id, null] as const;
      try {
        const response = await fetch(account.statusPath, { cache: "no-store" });
        const data = (await response.json()) as {
          connected?: boolean;
          login?: string | null;
          email?: string | null;
          oauthAvailable?: boolean;
          writesEnabled?: boolean;
        };
        return [account.id, {
          connected: data.connected === true,
          label: data.email ?? data.login ?? null,
          oauthAvailable: data.oauthAvailable === true,
          writesEnabled: data.writesEnabled === true
        }] as const;
      } catch {
        /* A status route that cannot be reached is not a disconnected account —
           saying so would invite a reconnect that fixes nothing. Leave the row
           unknown and let the refresh button be the remedy. */
        return [account.id, null] as const;
      }
    }));

    setAccounts((current) => {
      const next = { ...current };
      for (const [id, status] of entries) if (status) next[id] = status;
      return next;
    });
  }

  const connectedCount = useMemo(
    () => servers.filter((server) => preferences.connectedMcpServers.includes(server.id)).length
      + Object.values(accounts).filter((status) => status.connected).length,
    [accounts, preferences.connectedMcpServers, servers]
  );

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/connect", { cache: "no-store" });
      const data = (await response.json()) as { servers?: PublicMcpServer[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Connector directory could not be loaded.");
      setServers(Array.isArray(data.servers) ? data.servers : []);
    } catch (error) {
      setErrors({ directory: error instanceof Error ? error.message : "Connector directory could not be loaded." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refresh();
    void refreshAccounts();
  }, [open]);

  if (!open) return null;

  function update(patch: Partial<NaviPreferences>) {
    onPreferences({ ...preferences, ...patch });
  }

  async function disconnectAccount(account: AccountConnector) {
    if (!account.statusPath) return;
    haptic("selection", haptics);
    await fetch(account.statusPath, { method: "DELETE" }).catch(() => {});
    setAccounts((current) => ({
      ...current,
      [account.id]: { ...current[account.id], connected: false, label: null }
    }));
  }

  async function toggle(server: PublicMcpServer) {
    const connected = preferences.connectedMcpServers.includes(server.id);
    if (connected) {
      update({ connectedMcpServers: preferences.connectedMcpServers.filter((id) => id !== server.id) });
      setErrors((current) => ({ ...current, [server.id]: "" }));
      haptic("selection", haptics);
      return;
    }

    setConnecting(server.id);
    setErrors((current) => ({ ...current, [server.id]: "" }));
    try {
      const response = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: server.id })
      });
      const result = (await response.json()) as { connected?: boolean; error?: string };
      if (!response.ok || !result.connected) throw new Error(result.error || "Connection failed.");
      update({ connectedMcpServers: [...preferences.connectedMcpServers, server.id] });
      haptic("success", haptics);
    } catch (error) {
      setErrors((current) => ({ ...current, [server.id]: error instanceof Error ? error.message : "Connection failed." }));
      haptic("error", haptics);
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-app text-primary">
      <header className="safe-top flex min-h-[64px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-elev-1 px-3">
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close connectors"><X size={21} /></button>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.0625rem]/6 font-semibold text-primary">Connectors</span>
          <span className="block text-[0.6875rem]/4 font-medium text-tertiary">{connectedCount} connected · mobile access and approvals</span>
        </span>
        <button type="button" onClick={() => { void refresh(); void refreshAccounts(); }} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3 disabled:opacity-50" aria-label="Refresh connectors"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
      </header>

      <main className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 pb-[calc(24px+var(--safe-bottom))] pt-4">
          <section className="rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent"><ShieldCheck size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Conversation access mode</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Controls how connected resources may be used. Sensitive external actions never bypass confirmation.</p>
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {MODES.map((mode) => (
                <button key={mode.id} type="button" onClick={() => { update({ connectorAccessMode: mode.id }); haptic("selection", haptics); }} className={`flex min-h-[72px] w-full items-center gap-3 rounded-2xl border px-3 text-left ${preferences.connectorAccessMode === mode.id ? "border-accent bg-[var(--selection-bg)]" : "border-[var(--border-subtle)] bg-elev-2 active:bg-elev-3"}`}>
                  <span className="min-w-0 flex-1"><span className="block text-[0.875rem]/5 font-semibold text-primary">{mode.title}</span><span className="block text-[0.6875rem]/4 font-medium text-tertiary">{mode.detail}</span></span>
                  {preferences.connectorAccessMode === mode.id ? <Check size={18} className="shrink-0 text-accent" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-elev-2 text-secondary"><UserRoundCheck size={21} /></span>
              <span className="min-w-0 flex-1">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Accounts</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Signed in through this deployment. Tokens are held in cookies the page cannot read, never in the browser.</p>
              </span>
            </div>

            <div className="mt-3 divide-y divide-[var(--border-subtle)]">
              {ACCOUNTS.map((account) => {
                const status = accounts[account.id];
                const connected = status?.connected === true;
                /* Vercel has no status route because it is configured with a
                   deployment-wide token rather than per user, so it renders as
                   a statement rather than a control. */
                const configurable = Boolean(account.connectPath);
                return (
                  <div key={account.id} className="flex min-h-14 items-center gap-3 py-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? "bg-[var(--selection-bg)] text-accent" : "bg-elev-2 text-secondary"}`}>
                      <Link2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[0.875rem]/5 font-semibold text-primary">{account.name}</span>
                        {connected ? (
                          <span className="shrink-0 rounded-full bg-[var(--selection-bg)] px-2 py-0.5 text-[0.625rem]/4 font-semibold uppercase tracking-[0.06em] text-accent">
                            {status?.writesEnabled ? "Read and write" : "Read only"}
                          </span>
                        ) : null}
                      </span>
                      {/* What it can do, plainly. A connected account that only
                          says "GitHub" leaves the one question worth answering
                          — what did I just allow — unanswered. */}
                      <span className="mt-0.5 block text-[0.6875rem]/4 font-medium text-tertiary">
                        {connected
                          ? `${status?.label ? `${status.label} · ` : ""}${status?.writesEnabled && account.writes ? `${account.reads}. ${account.writes}.` : `${account.reads}.`}`
                          : status?.oauthAvailable === false || !configurable
                            ? account.setup ?? account.detail
                            : `${account.reads}.`}
                      </span>
                    </span>
                    {!configurable ? null : connected ? (
                      <button type="button" onClick={() => void disconnectAccount(account)} className="min-h-11 shrink-0 rounded-xl px-3 text-[0.8125rem]/5 font-semibold text-danger active:bg-elev-3">Disconnect</button>
                    ) : status?.oauthAvailable === false ? null : (
                      <a href={account.connectPath} className="flex min-h-11 shrink-0 items-center rounded-xl bg-accent px-4 text-[0.8125rem]/5 font-semibold text-white active:bg-accent-pressed">Connect</a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-elev-2 text-secondary"><Link2 size={21} /></span>
              <span className="min-w-0 flex-1"><h2 className="text-[0.9375rem]/5 font-semibold text-primary">Available connectors</h2><p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Configured through the server-side MCP registry. Credentials never enter the browser.</p></span>
            </div>

            {errors.directory ? <div className="mt-3 flex gap-2 rounded-2xl border border-[var(--accent-danger)] bg-elev-2 p-3 text-[0.75rem]/4 font-medium text-danger"><AlertTriangle size={16} className="shrink-0" />{errors.directory}</div> : null}

            <div className="mt-3 divide-y divide-[var(--border-subtle)]">
              {servers.map((server) => {
                const connected = preferences.connectedMcpServers.includes(server.id);
                return (
                  <div key={server.id} className="py-3">
                    <div className="flex min-h-14 items-center gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? "bg-[var(--selection-bg)] text-accent" : "bg-elev-2 text-secondary"}`}><Link2 size={18} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[0.875rem]/5 font-semibold text-primary">{server.name}</span><span className="block truncate text-[0.6875rem]/4 font-medium text-tertiary">Remote HTTPS MCP · {server.readOnly ? "read-only" : "writes require confirmation"}</span></span>
                      {connecting === server.id ? <LoaderCircle size={19} className="animate-spin text-accent" /> : <Switch value={connected} label={`${connected ? "Disconnect" : "Connect"} ${server.name}`} onChange={() => void toggle(server)} />}
                    </div>
                    {errors[server.id] ? <div className="ml-[52px] mt-1 flex gap-1.5 text-[0.6875rem]/4 font-medium text-danger"><AlertTriangle size={14} className="shrink-0" />{errors[server.id]}</div> : null}
                  </div>
                );
              })}
              {/* There is deliberately no Add button: a connector server carries
                  credentials, so it is registered in the deployment rather than
                  typed into a phone. An empty panel with no explanation reads as
                  a missing feature, so name the thing that adds one. */}
              {!loading && !servers.length ? (
                <div className="py-8 text-center">
                  <p className="text-[0.8125rem]/5 font-medium text-secondary">No connector servers yet.</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-[0.6875rem]/4 font-medium text-tertiary">
                    These are added by the deployment, not from this device, so their credentials never reach the browser. Set <span className="font-mono text-secondary">MCP_SERVER_REGISTRY_JSON</span> in Vercel and redeploy.
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
            <div className="flex gap-3"><LockKeyhole size={19} className="mt-0.5 shrink-0 text-accent" /><div><h2 className="text-[0.875rem]/5 font-semibold text-primary">Approval contract</h2><p className="mt-1 text-[0.75rem]/5 font-medium text-secondary">Reads may follow the selected access mode. Writes, purchases, bookings, deletes, and external sends require an explicit approval step. Disconnected, expired, blocked, and unsupported connectors remain visibly unavailable.</p></div></div>
          </section>
        </div>
      </main>
    </div>
  );
}
