"use client";

import { AlertTriangle, Check, ChevronDown, Link2, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, User, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CONNECTOR_KINDS, type ConnectorAccessMode, type CustomConnector, type CustomConnectorKind, type NaviPreferences } from "@/lib/ai/types";
import type { CapabilityManifest } from "@/lib/ai/capabilities/manifest";
import type { AddedCapability } from "@/lib/ai/capabilities/search";
import { createId } from "@/lib/chat";
import type { PublicMcpServer } from "@/lib/mcp";
import { haptic } from "@/lib/ui/haptics";
import { cloudSyncActive } from "@/lib/memory/cloud-sync";

type Props = {
  open: boolean;
  preferences: NaviPreferences;
  haptics: boolean;
  onClose: () => void;
  onPreferences: (preferences: NaviPreferences) => void;
};

const MODES: Array<{ id: ConnectorAccessMode; title: string; detail: string }> = [
  { id: "ask", title: "Ask every time", detail: "Navi Soul may inspect connector availability, but external access waits for your approval." },
  { id: "auto", title: "Auto for reads", detail: "Read-only resources may be used automatically. Writes, deletes, sends, bookings, and purchases still require approval." },
  { id: "always", title: "Always available", detail: "Connected read-only resources stay available in this conversation. Sensitive actions still require explicit confirmation." }
];

type AccountConnector = {
  id: "github" | "google" | "vercel";
  name: string;
  detail: string;
  connectPath?: string;
  statusPath?: string;
  setup?: string;
  reads: string;
  writes?: string;
  unlockWrites?: string;
};

const ACCOUNTS: AccountConnector[] = [
  {
    id: "google",
    name: "Google",
    detail: "Gmail and Calendar",
    connectPath: "/api/google/oauth/start",
    statusPath: "/api/google/status",
    setup: "Not available on this deployment yet. It has to be enabled by whoever administers it; the steps are under Settings → Developer.",
    reads: "Read your mail and calendar",
    writes: "Send mail and create events"
  },
  {
    id: "github",
    name: "GitHub",
    detail: "Repositories, pull requests, and CI logs",
    connectPath: "/api/github/oauth/start",
    statusPath: "/api/github/status",
    setup: "Not available on this deployment yet. It has to be enabled by whoever administers it; the steps are under Settings → Developer.",
    reads: "Read repositories, pull requests, and CI logs",
    writes: "Commit to a working branch and open pull requests",
    unlockWrites: "Writes are off for this deployment, so Navi Soul can read your repositories but not change them. Turning them on is a deployment setting; the steps are under Settings → Developer."
  },
  {
    id: "vercel",
    name: "Vercel",
    detail: "Deployments and build logs",
    setup: "Set up once for the whole deployment, not per person. Nothing to connect here.",
    reads: "Read deployments and build logs"
  }
];

type AccountStatus = {
  connected: boolean;
  label: string | null;
  oauthAvailable: boolean;
  writesEnabled: boolean;
};

// UI Components
function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-6 px-4 text-[0.8125rem] font-medium text-tertiary uppercase tracking-wide">{children}</h3>;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-6 overflow-hidden rounded-[10px] bg-elev-2 shadow-sm">{children}</div>;
}

function InlineButton({ children, onClick, disabled, destructive }: { children: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 shrink-0 rounded-[8px] px-3 text-[0.875rem] font-semibold active:bg-elev-4 disabled:opacity-50 ${destructive ? "bg-red-500/10 text-danger" : "bg-accent/10 text-accent"}`}
    >
      {children}
    </button>
  );
}

function SettingsToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-[120ms] ${value ? "bg-accent" : "bg-elev-3"}`}
    >
      <span className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-sm transition-transform duration-[140ms] ${value ? "translate-x-[20px]" : "translate-x-0"}`} />
    </button>
  );
}

export function ConnectorsSheet({ open, preferences, haptics, onClose, onPreferences }: Props) {
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<CustomConnectorKind>("openai");
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [addState, setAddState] = useState<{ phase: "idle" | "testing" | "error"; message?: string }>({ phase: "idle" });

  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiOpen, setApiOpen] = useState(false);
  const [discovery, setDiscovery] = useState<
    | { phase: "idle" }
    | { phase: "looking" }
    | { phase: "failed"; message: string; detail: string }
    | { phase: "found"; manifest: CapabilityManifest; summary: { operations: number; reads: number; writes: number; auth: string; truncated?: { declared: number; kept: number } } }
  >({ phase: "idle" });

  const capabilities = (preferences.capabilities ?? []) as AddedCapability[];

  async function discoverApi() {
    const baseUrl = apiUrl.trim();
    if (!baseUrl) return;
    setDiscovery({ phase: "looking" });
    haptic("selection", haptics);
    try {
      const response = await fetch("/api/capabilities/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl })
      });
      const data = await response.json() as {
        ok?: boolean; error?: string; detail?: string;
        manifest?: CapabilityManifest;
        summary?: { operations: number; reads: number; writes: number; auth: string; truncated?: { declared: number; kept: number } };
      };
      if (!response.ok || !data.ok || !data.manifest || !data.summary) {
        setDiscovery({ phase: "failed", message: data.error ?? "That could not be read.", detail: data.detail ?? "" });
        haptic("warning", haptics);
        return;
      }
      setDiscovery({ phase: "found", manifest: data.manifest, summary: data.summary });
      haptic("success", haptics);
    } catch {
      setDiscovery({ phase: "failed", message: "That address could not be reached.", detail: "" });
      haptic("error", haptics);
    }
  }

  function saveApi() {
    if (discovery.phase !== "found") return;
    const manifest = discovery.manifest;
    haptic("success", haptics);
    onPreferences({
      ...preferences,
      capabilities: [
        ...capabilities.filter((entry) => entry?.manifest?.id !== manifest.id),
        { manifest, apiKey: apiKey.trim(), approvedWrites: [] }
      ]
    });
    setApiUrl("");
    setApiKey("");
    setApiOpen(false);
    setDiscovery({ phase: "idle" });
  }

  function removeApi(id: string) {
    haptic("impact-light", haptics);
    onPreferences({ ...preferences, capabilities: capabilities.filter((entry) => entry?.manifest?.id !== id) });
  }

  type CatalogProvider = { id: string; label: string; envKey: string; keyUrl: string; free: boolean; detail: string; configured: boolean };
  const [catalog, setCatalog] = useState<{ selfConfigurable: boolean; setupHint: string | null; providers: CatalogProvider[] }>(
    { selfConfigurable: false, setupHint: null, providers: [] }
  );
  const [keyDraftFor, setKeyDraftFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [verified, setVerified] = useState<Record<string, { ok: boolean; reason: string }>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [keysAreDurable, setKeysAreDurable] = useState(false);

  useEffect(() => { if (open) setKeysAreDurable(cloudSyncActive()); }, [open]);

  async function verify(id: string) {
    setVerifying(id);
    try {
      const response = await fetch("/api/connectors/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id })
      });
      const data = (await response.json()) as { ok?: boolean; reason?: string; error?: string };
      setVerified((current) => ({
        ...current,
        [id]: { ok: data.ok === true, reason: data.reason ?? data.error ?? "No answer." }
      }));
      haptic(data.ok === true ? "success" : "error", haptics);
    } catch {
      setVerified((current) => ({ ...current, [id]: { ok: false, reason: "The test could not run." } }));
    } finally {
      setVerifying(null);
    }
  }

  async function refreshCatalog() {
    try {
      const response = await fetch("/api/connectors/provision", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { selfConfigurable?: boolean; setupHint?: string | null; providers?: CatalogProvider[] };
      setCatalog({
        selfConfigurable: data.selfConfigurable === true,
        setupHint: data.setupHint ?? null,
        providers: Array.isArray(data.providers) ? data.providers : []
      });
    } catch {
      // Ignore
    }
  }

  async function provision(provider: CatalogProvider) {
    const value = keyDraft.trim();
    if (!value) return;
    setProvisioning(provider.id);
    setErrors((current) => ({ ...current, [provider.id]: "" }));
    try {
      const response = await fetch("/api/connectors/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, value })
      });
      const data = (await response.json()) as { note?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "That key could not be saved.");
      setKeyDraft("");
      setKeyDraftFor(null);
      haptic("success", haptics);
      await refreshCatalog();
    } catch (error) {
      setErrors((current) => ({ ...current, [provider.id]: error instanceof Error ? error.message : "That key could not be saved." }));
      haptic("error", haptics);
    } finally {
      setProvisioning(null);
    }
  }

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
        return [account.id, null] as const;
      }
    }));

    setAccounts((current) => {
      const next = { ...current };
      for (const [id, status] of entries) if (status) next[id] = status;
      return next;
    });
  }

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
    void refreshCatalog();
  }, [open]);

  if (!open) return null;

  function update(patch: Partial<NaviPreferences>) {
    onPreferences({ ...preferences, ...patch });
  }

  async function addCustomConnector() {
    const name = draftName.trim();
    const baseUrl = draftUrl.trim();
    if (!name || !baseUrl) {
      setAddState({ phase: "error", message: "A name and base URL are required." });
      return;
    }
    if (!baseUrl.startsWith("https://")) {
      setAddState({ phase: "error", message: "The base URL must start with https://." });
      return;
    }
    if (preferences.customConnectors.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      setAddState({ phase: "error", message: "A connector with that name already exists." });
      return;
    }

    setAddState({ phase: "testing" });
    try {
      const response = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: draftKind, baseUrl, apiKey: draftKey.trim() })
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!result.ok) {
        setAddState({ phase: "error", message: result.error || "The connector did not answer." });
        haptic("error", haptics);
        return;
      }
    } catch {
      setAddState({ phase: "error", message: "The connection test could not run." });
      haptic("error", haptics);
      return;
    }

    const connector: CustomConnector = {
      id: createId("connector"),
      kind: draftKind,
      name,
      baseUrl,
      apiKey: draftKey.trim(),
      model: draftModel.trim() || undefined
    };
    update({ customConnectors: [...preferences.customConnectors, connector] });
    setDraftName("");
    setDraftUrl("");
    setDraftKey("");
    setDraftModel("");
    setAddOpen(false);
    setAddState({ phase: "idle" });
    haptic("success", haptics);
  }

  function removeCustomConnector(id: string) {
    update({ customConnectors: preferences.customConnectors.filter((entry) => entry.id !== id) });
    haptic("selection", haptics);
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
    <div className="fixed inset-0 z-[120] flex flex-col bg-page text-primary">
      <header className="navi-sheet-header sticky top-0 z-10 flex min-h-[calc(44px+var(--safe-top))] pt-[var(--safe-top)] pb-1 shrink-0 items-center justify-between bg-page px-2 border-b border-[var(--border-subtle)]">
        <button type="button" onClick={() => { void refresh(); void refreshAccounts(); void refreshCatalog(); }} disabled={loading} className="flex h-11 w-[80px] items-center justify-start pl-3 rounded-full text-accent font-normal text-[1.0625rem] active:opacity-60 disabled:opacity-50">
          {loading ? <LoaderCircle size={20} className="animate-spin" /> : "Refresh"}
        </button>
        <div className="flex-1 text-center text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary">
          Connectors
        </div>
        <button type="button" onClick={onClose} className="flex h-11 w-[80px] items-center justify-end pr-3 rounded-full text-accent font-semibold text-[1.0625rem] active:opacity-60">
          Done
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] pt-2">
        <div className="mx-auto w-full max-w-[760px]">

          <SectionHeader>Access Mode</SectionHeader>
          <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Controls how connected resources may be used. Sensitive actions always require confirmation.</p>
          <Group>
            {MODES.map((mode) => (
              <button key={mode.id} type="button" onClick={() => { update({ connectorAccessMode: mode.id }); haptic("selection", haptics); }} className="flex min-h-[44px] w-full items-center justify-between border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-2.5 text-left active:bg-elev-3">
                <div className="flex flex-col flex-1 min-w-0 pr-4">
                  <span className="text-[1rem]/[1.375rem] text-primary">{mode.title}</span>
                  {preferences.connectorAccessMode === mode.id && <span className="text-[0.8125rem]/[1.125rem] text-tertiary mt-0.5">{mode.detail}</span>}
                </div>
                {preferences.connectorAccessMode === mode.id && <Check size={20} className="text-accent shrink-0" />}
              </button>
            ))}
          </Group>

          <SectionHeader>Active Integrations</SectionHeader>
          <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Signed in through this deployment. Tokens are stored securely.</p>
          <Group>
            {ACCOUNTS.map((account) => {
              const status = accounts[account.id];
              const connected = status?.connected === true;
              const configurable = Boolean(account.connectPath);
              return (
                <div key={account.id} className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white ${connected ? "bg-success" : "bg-[var(--text-tertiary)]"}`}>
                        {account.id === "google" ? <User size={18} /> : account.id === "github" ? <Link2 size={18} /> : <ShieldCheck size={18} />}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[1rem]/[1.375rem] font-medium text-primary truncate">{account.name}</span>
                        {connected && (
                          <span className="shrink-0 rounded-[4px] bg-accent/15 px-1.5 py-0.5 text-[0.625rem]/4 font-bold uppercase tracking-wider text-accent">
                            {status?.writesEnabled ? "Read / Write" : "Read Only"}
                          </span>
                        )}
                      </div>
                    </div>
                    {!configurable ? null : connected ? (
                      <button type="button" onClick={() => void disconnectAccount(account)} className="text-[0.9375rem] font-medium text-danger active:opacity-60 shrink-0">Disconnect</button>
                    ) : status?.oauthAvailable === false ? null : (
                      <a href={account.connectPath} className="text-[0.9375rem] font-medium text-accent active:opacity-60 shrink-0">Connect</a>
                    )}
                  </div>
                  <div className="mt-2 text-[0.8125rem]/[1.125rem] text-tertiary pl-[44px]">
                    {connected
                      ? `${status?.label ? `${status.label} · ` : ""}${status?.writesEnabled && account.writes ? `${account.reads}. ${account.writes}.` : `${account.reads}.`}`
                      : status?.oauthAvailable === false || !configurable
                        ? account.setup ?? account.detail
                        : `${account.reads}.`}
                  </div>
                  {connected && !status?.writesEnabled && account.unlockWrites && (
                    <div className="mt-2 pl-[44px] text-[0.8125rem]/[1.125rem] text-tertiary">{account.unlockWrites}</div>
                  )}
                </div>
              );
            })}
          </Group>

          <SectionHeader>Available Integrations</SectionHeader>
          <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">{catalog.selfConfigurable ? "Add API keys for external services. Keys travel securely." : catalog.setupHint ?? "Loading…"}</p>
          <Group>
            {catalog.providers.filter((provider) => provider.configured || catalogExpanded || keyDraftFor === provider.id).map((provider) => (
              <div key={provider.id} className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white ${provider.configured ? "bg-success" : "bg-[var(--text-tertiary)]"}`}>
                      {provider.configured ? <Check size={18} /> : <Plus size={18} />}
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[1rem]/[1.375rem] font-medium text-primary truncate">{provider.label}</span>
                      {provider.free && <span className="shrink-0 rounded-[4px] bg-elev-3 px-1.5 py-0.5 text-[0.625rem]/4 font-bold uppercase tracking-wider text-tertiary">Free</span>}
                    </div>
                  </div>
                  {provisioning === provider.id ? (
                    <LoaderCircle size={20} className="shrink-0 animate-spin text-accent" />
                  ) : (
                    <div className="flex items-center gap-4 shrink-0">
                      {provider.configured && (
                        <button type="button" disabled={verifying === provider.id} onClick={() => void verify(provider.id)} className="text-[0.9375rem] font-medium text-accent active:opacity-60 disabled:opacity-50">
                          {verifying === provider.id ? "Testing" : "Test"}
                        </button>
                      )}
                      <button type="button" onClick={() => { setKeyDraftFor(keyDraftFor === provider.id ? null : provider.id); setKeyDraft(""); haptic("selection", haptics); }} className="text-[0.9375rem] font-medium text-accent active:opacity-60">
                        {provider.configured ? "Edit" : "Add"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-2 pl-[44px] text-[0.8125rem]/[1.125rem] text-tertiary">{provider.detail}</div>
                
                {verified[provider.id] && (
                  <div className={`mt-2 flex items-center gap-1.5 pl-[44px] text-[0.8125rem] font-medium ${verified[provider.id].ok ? "text-success" : "text-danger"}`}>
                    {verified[provider.id].ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                    {verified[provider.id].reason}
                  </div>
                )}

                {keyDraftFor === provider.id && (
                  <div className="mt-3 pl-[44px] space-y-2 pb-1">
                    <input
                      value={keyDraft}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      placeholder={`Paste your ${provider.label} key`}
                      type="password"
                      autoComplete="off"
                      autoCapitalize="none"
                      className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent"
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void provision(provider)}
                        disabled={!keyDraft.trim() || !catalog.selfConfigurable}
                        className="flex h-9 flex-1 items-center justify-center rounded-[8px] bg-accent px-4 text-[0.875rem] font-semibold text-white active:opacity-80 disabled:opacity-50"
                      >
                        Connect & Deploy
                      </button>
                      <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener" className="flex h-9 items-center justify-center rounded-[8px] bg-elev-3 px-4 text-[0.875rem] font-semibold text-primary active:bg-elev-4">Get Key</a>
                    </div>
                    {errors[provider.id] && <div className="flex gap-1.5 text-[0.8125rem] font-medium text-danger mt-1"><AlertTriangle size={14} />{errors[provider.id]}</div>}
                  </div>
                )}
              </div>
            ))}
            {!catalog.providers.length && <div className="py-6 text-center text-[0.875rem] text-tertiary">Loading services...</div>}
            {catalog.providers.length > 0 && (
              <button type="button" onClick={() => { setCatalogExpanded(!catalogExpanded); haptic("selection", haptics); }} className="flex min-h-[44px] w-full items-center justify-center gap-1.5 text-[0.875rem] font-medium text-accent active:bg-elev-3 transition-colors">
                {catalogExpanded ? "Show fewer" : `Show all ${catalog.providers.length} services`}
                <ChevronDown size={16} className={`shrink-0 transition-transform ${catalogExpanded ? "rotate-180" : ""}`} />
              </button>
            )}
          </Group>

          <SectionHeader>Remote & MCP Servers</SectionHeader>
          <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Directory of remote MCP servers configured for this deployment.</p>
          {errors.directory && <div className="mx-4 mb-3 flex gap-2 rounded-[10px] bg-red-500/10 p-3 text-[0.8125rem] font-medium text-danger"><AlertTriangle size={16} className="shrink-0" />{errors.directory}</div>}
          
          <Group>
            {servers.map((server) => {
              const connected = preferences.connectedMcpServers.includes(server.id);
              return (
                <div key={server.id} className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white ${connected ? "bg-success" : "bg-[var(--text-tertiary)]"}`}><Link2 size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[1rem]/[1.375rem] font-medium text-primary">{server.name}</div>
                      <div className="text-[0.8125rem]/[1.125rem] text-tertiary mt-0.5">Remote HTTPS MCP · {server.readOnly ? "read-only" : "writes require confirmation"}</div>
                    </div>
                    {connecting === server.id ? <LoaderCircle size={20} className="animate-spin text-accent" /> : <SettingsToggle value={connected} label={`${connected ? "Disconnect" : "Connect"} ${server.name}`} onChange={() => void toggle(server)} />}
                  </div>
                  {errors[server.id] && <div className="mt-2 pl-[44px] flex gap-1.5 text-[0.8125rem] font-medium text-danger"><AlertTriangle size={14} className="shrink-0" />{errors[server.id]}</div>}
                </div>
              );
            })}
            {!loading && !servers.length && (
              <div className="py-6 px-4 text-center">
                <p className="text-[0.875rem] font-medium text-primary">No remote servers yet.</p>
                <p className="mt-1 text-[0.8125rem] text-tertiary">Connector servers are set up for the whole deployment. Admins can configure them under Settings → Developer.</p>
              </div>
            )}
          </Group>

          <SectionHeader>Custom APIs</SectionHeader>
          <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Connect any API by pasting its base URL. {keysAreDurable ? "Keys sync to your account." : "Keys are stored locally in this browser."}</p>
          <Group>
            {preferences.customConnectors.map((connector) => (
              <div key={connector.id} className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3 flex items-center gap-3">
                <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white bg-success"><Sparkles size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[1rem]/[1.375rem] font-medium text-primary truncate">{connector.name}</div>
                  <div className="text-[0.8125rem]/[1.125rem] text-tertiary mt-0.5 truncate">{CONNECTOR_KINDS.find((k) => k.id === connector.kind)?.label ?? connector.kind} · {new URL(connector.baseUrl).hostname}</div>
                </div>
                <button type="button" onClick={() => removeCustomConnector(connector.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-danger active:bg-elev-3"><Trash2 size={18} /></button>
              </div>
            ))}
            
            {capabilities.map((entry) => (
              <div key={entry.manifest.id} className="border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-3 flex items-center gap-3">
                <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white bg-success"><Sparkles size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[1rem]/[1.375rem] font-medium text-primary truncate">{entry.manifest.name}</div>
                  <div className="text-[0.8125rem]/[1.125rem] text-tertiary mt-0.5 truncate">{entry.manifest.operations.length} operations · {new URL(entry.manifest.baseUrl).hostname}</div>
                </div>
                <button type="button" onClick={() => removeApi(entry.manifest.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-danger active:bg-elev-3"><Trash2 size={18} /></button>
              </div>
            ))}

            <button type="button" onClick={() => { setApiOpen(true); haptic("selection", haptics); }} className="flex min-h-[44px] w-full items-center gap-3 px-4 text-left active:bg-elev-3 transition-colors text-accent">
              <Plus size={20} />
              <span className="text-[1rem]/[1.375rem] font-medium">Discover API</span>
            </button>

            <button type="button" onClick={() => { setAddOpen(true); haptic("selection", haptics); }} className="flex min-h-[44px] border-t border-[var(--border-subtle)] w-full items-center gap-3 px-4 text-left active:bg-elev-3 transition-colors text-accent">
              <Plus size={20} />
              <span className="text-[1rem]/[1.375rem] font-medium">Manual Custom Connector</span>
            </button>
          </Group>

          {addOpen && (
            <Group>
              <div className="p-4 space-y-3 bg-app">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-[1rem] font-semibold text-primary">Manual Connector</h4>
                  <button type="button" onClick={() => setAddOpen(false)} className="text-accent text-[0.9375rem]">Cancel</button>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[0.8125rem] text-tertiary">Type</span>
                  <span className="relative block">
                    <select value={draftKind} onChange={(event) => { setDraftKind(event.target.value as CustomConnectorKind); setAddState({ phase: "idle" }); }} className="h-10 w-full appearance-none rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 pr-10 text-[0.9375rem] text-primary outline-none focus:border-accent">
                      {CONNECTOR_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary" />
                  </span>
                </label>
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Name, e.g. My Database" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder={CONNECTOR_KINDS.find((k) => k.id === draftKind)?.urlHint || "https://..."} inputMode="url" autoCapitalize="none" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                <input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder={draftKind === "supabase" ? "Anon key" : "API key"} type="password" autoComplete="off" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                {CONNECTOR_KINDS.find((k) => k.id === draftKind)?.needsModel && (
                  <input value={draftModel} onChange={(event) => setDraftModel(event.target.value)} placeholder="Default model (optional)" autoCapitalize="none" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                )}
                {addState.phase === "error" && <div className="flex gap-1.5 text-[0.8125rem] text-danger mt-1"><AlertTriangle size={14} className="shrink-0" />{addState.message}</div>}
                <button type="button" onClick={() => void addCustomConnector()} disabled={addState.phase === "testing"} className="h-10 w-full rounded-[8px] bg-accent font-semibold text-white active:opacity-80 disabled:opacity-50 mt-2 flex items-center justify-center gap-2">
                  {addState.phase === "testing" ? <><LoaderCircle size={16} className="animate-spin" />Testing...</> : "Add Connector"}
                </button>
              </div>
            </Group>
          )}

          {apiOpen && (
            <Group>
              <div className="p-4 space-y-3 bg-app">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-[1rem] font-semibold text-primary">Discover API</h4>
                  <button type="button" onClick={() => { setApiOpen(false); setDiscovery({ phase: "idle" }); }} className="text-accent text-[0.9375rem]">Cancel</button>
                </div>
                <input value={apiUrl} onChange={(event) => { setApiUrl(event.target.value); setDiscovery({ phase: "idle" }); }} placeholder="https://api.example.com" inputMode="url" autoCapitalize="none" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key (optional)" type="password" autoCapitalize="none" className="h-10 w-full rounded-[8px] border border-[var(--border-subtle)] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                <p className="text-[0.8125rem] text-tertiary mt-1">Keys travel only with your requests. Not sent for discovery.</p>

                {discovery.phase === "failed" && (
                  <div className="mt-2 rounded-[8px] bg-red-500/10 p-3 text-[0.8125rem] text-danger">
                    <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} />{discovery.message}</div>
                    {discovery.detail && <div className="mt-1 opacity-80 break-all">{discovery.detail}</div>}
                  </div>
                )}

                {discovery.phase === "found" && (
                  <div className="mt-2 rounded-[8px] bg-accent/10 p-3 border border-accent/20">
                    <div className="text-[0.9375rem] font-semibold text-accent">{discovery.manifest.name}</div>
                    {discovery.manifest.purpose && <div className="text-[0.8125rem] text-primary mt-1">{discovery.manifest.purpose}</div>}
                    <div className="text-[0.8125rem] text-secondary mt-2">
                      {discovery.summary.operations} operations · {discovery.summary.reads} read {discovery.summary.writes ? `· ${discovery.summary.writes} writes` : ""}
                    </div>
                    <div className="text-[0.8125rem] text-secondary mt-1">Auth: {discovery.summary.auth}</div>
                    {discovery.summary.truncated && (
                      /* Said before it is saved, which is the only moment it can
                         change a decision. A large API silently becoming its
                         first 120 operations surfaces much later as "why can it
                         not do the thing the docs describe", and by then nothing
                         on screen explains it. The count already arrives in the
                         response; it was simply not being rendered. */
                      <div className="text-[0.8125rem] text-warning mt-1">
                        This API describes {discovery.summary.truncated.declared} operations and the first{" "}
                        {discovery.summary.truncated.kept} were kept. The rest will not be available.
                      </div>
                    )}
                    <button type="button" onClick={saveApi} className="mt-3 h-10 w-full rounded-[8px] bg-accent font-semibold text-white active:opacity-80 flex items-center justify-center gap-2">
                      <Check size={16} /> Add {discovery.manifest.name}
                    </button>
                  </div>
                )}

                {discovery.phase !== "found" && (
                  <button type="button" onClick={() => void discoverApi()} disabled={discovery.phase === "looking" || !apiUrl.trim()} className="h-10 w-full rounded-[8px] bg-accent font-semibold text-white active:opacity-80 disabled:opacity-50 mt-2 flex items-center justify-center gap-2">
                    {discovery.phase === "looking" ? <><LoaderCircle size={16} className="animate-spin" />Reading API...</> : "Read API"}
                  </button>
                )}
              </div>
            </Group>
          )}
        </div>
      </main>
    </div>
  );
}
