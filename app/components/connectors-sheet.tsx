"use client";

import { AlertTriangle, Check, Link2, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, X } from "lucide-react";
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
  { id: "ask", title: "Ask every time", detail: "NaviSol may inspect connector availability, but external access waits for your approval." },
  { id: "auto", title: "Auto for reads", detail: "Read-only resources may be used automatically. Writes, deletes, sends, bookings, and purchases still require approval." },
  { id: "always", title: "Always available", detail: "Connected read-only resources stay available in this conversation. Sensitive actions still require explicit confirmation." }
];

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

  const connectedCount = useMemo(
    () => servers.filter((server) => preferences.connectedMcpServers.includes(server.id)).length,
    [preferences.connectedMcpServers, servers]
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
    if (open) void refresh();
  }, [open]);

  if (!open) return null;

  function update(patch: Partial<NaviPreferences>) {
    onPreferences({ ...preferences, ...patch });
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
        <button type="button" onClick={() => void refresh()} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3 disabled:opacity-50" aria-label="Refresh connectors"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
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
              {!loading && !servers.length ? <div className="py-10 text-center text-[0.8125rem]/5 font-medium text-tertiary">No connector servers are configured in Vercel.</div> : null}
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
