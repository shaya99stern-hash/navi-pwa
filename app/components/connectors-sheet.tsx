"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Github,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
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

type AccountConnector = {
  id: "github" | "google" | "vercel";
  name: string;
  detail: string;
  connectPath?: string;
  statusPath?: string;
  setup?: string;
  reads: string;
  writes?: string;
};

type AccountStatus = {
  connected: boolean;
  label: string | null;
  oauthAvailable: boolean;
  writesEnabled: boolean;
};

type CatalogProvider = {
  id: string;
  label: string;
  envKey: string;
  keyUrl: string;
  free: boolean;
  detail: string;
  configured: boolean;
};

const MODES: Array<{ id: ConnectorAccessMode; title: string; detail: string }> = [
  { id: "ask", title: "Ask every time", detail: "External access waits for your approval." },
  { id: "auto", title: "Auto for reads", detail: "Read-only resources may be used automatically. Sensitive actions still ask." },
  { id: "always", title: "Always available", detail: "Connected read-only resources stay available in the conversation." }
];

const ACCOUNTS: AccountConnector[] = [
  {
    id: "google",
    name: "Google",
    detail: "Gmail and Calendar",
    connectPath: "/api/google/oauth/start",
    statusPath: "/api/google/status",
    setup: "Google access is configured by the deployment administrator.",
    reads: "Read mail and calendar",
    writes: "Send mail and create events"
  },
  {
    id: "github",
    name: "GitHub",
    detail: "Repositories and CI",
    connectPath: "/api/github/oauth/start",
    statusPath: "/api/github/status",
    setup: "GitHub access is configured by the deployment administrator.",
    reads: "Read repositories, pull requests, and CI logs",
    writes: "Commit to a working branch and open pull requests"
  },
  {
    id: "vercel",
    name: "Vercel",
    detail: "Deployments and build logs",
    setup: "Connected at the deployment level.",
    reads: "Read deployments and build logs"
  }
];

function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="connectors-section-title px-4">{children}</h3>;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="connectors-group mx-4 overflow-hidden">{children}</div>;
}

function Divider({ inset = true }: { inset?: boolean }) {
  return <div className={`h-px bg-[var(--border-subtle)] ${inset ? "ml-[54px]" : ""}`} aria-hidden="true" />;
}

function hostOf(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function initials(label: string) {
  const parts = label.trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return "•";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function BrandMark({ id, label, connected }: { id: string; label: string; connected?: boolean }) {
  const common = "brand-mark flex shrink-0 items-center justify-center text-[11px] font-bold text-secondary";
  if (id === "github") return <span className={common}><Github size={18} strokeWidth={1.8} /></span>;
  if (id === "vercel") return (
    <span className={common} aria-label="Vercel">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 22 20H2L12 4Z" fill="currentColor" /></svg>
    </span>
  );
  if (id === "google") return <span className={`${common} text-[16px] font-semibold`} aria-label="Google">G</span>;
  if (id === "supabase") return (
    <span className={common} aria-label="Supabase"><svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.4 13h7.2L10.8 22 19.6 11h-7.2L13.2 2Z" fill="currentColor" /></svg></span>
  );
  return <span className={`${common} ${connected ? "text-success" : ""}`}>{initials(label)}</span>;
}

function CompactToggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={onChange} className={`settings-switch relative h-6 w-10 shrink-0 rounded-full border transition-colors ${value ? "border-accent bg-accent" : "border-[var(--border-strong)] bg-elev-3"}`}>
      <span className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${value ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function DisclosureRow({ title, detail, open, onToggle, leading, trailing }: {
  title: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="connectors-row flex w-full items-center gap-3 bg-transparent px-4 text-left active:bg-elev-2">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="connectors-row-label truncate font-medium text-primary">{title}</div>
        {detail ? <div className="connectors-row-description mt-0.5 truncate text-tertiary">{detail}</div> : null}
      </div>
      {trailing}
      <ChevronDown size={18} className={`shrink-0 text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export function ConnectorsSheet({ open, preferences, haptics, onClose, onPreferences }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ selfConfigurable: boolean; setupHint: string | null; providers: CatalogProvider[] }>({ selfConfigurable: false, setupHint: null, providers: [] });
  const [accessOpen, setAccessOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [keyDraftFor, setKeyDraftFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, { ok: boolean; reason: string }>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [keysAreDurable, setKeysAreDurable] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<CustomConnectorKind>("openai");
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [addState, setAddState] = useState<{ phase: "idle" | "testing" | "error"; message?: string }>({ phase: "idle" });
  const [apiOpen, setApiOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [discovery, setDiscovery] = useState<
    | { phase: "idle" }
    | { phase: "looking" }
    | { phase: "failed"; message: string; detail: string }
    | { phase: "found"; manifest: CapabilityManifest; summary: { operations: number; reads: number; writes: number; auth: string; truncated?: { declared: number; kept: number } } }
  >({ phase: "idle" });

  const capabilities = (preferences.capabilities ?? []) as AddedCapability[];
  const activeMode = MODES.find((mode) => mode.id === preferences.connectorAccessMode) ?? MODES[0];
  const configuredProviders = useMemo(() => catalog.providers.filter((provider) => provider.configured).length, [catalog.providers]);
  const customCount = preferences.customConnectors.length + capabilities.length;

  function update(patch: Partial<NaviPreferences>) {
    onPreferences({ ...preferences, ...patch });
  }

  async function refreshAccounts() {
    const entries = await Promise.all(ACCOUNTS.map(async (account) => {
      if (!account.statusPath) return [account.id, null] as const;
      try {
        const response = await fetch(account.statusPath, { cache: "no-store" });
        const data = await response.json() as { connected?: boolean; login?: string | null; email?: string | null; oauthAvailable?: boolean; writesEnabled?: boolean };
        return [account.id, {
          connected: data.connected === true,
          label: data.login ?? data.email ?? null,
          oauthAvailable: data.oauthAvailable === true,
          writesEnabled: data.writesEnabled === true
        }] as const;
      } catch { return [account.id, null] as const; }
    }));
    setAccounts((current) => {
      const next = { ...current };
      for (const [id, status] of entries) if (status) next[id] = status;
      return next;
    });
  }

  async function refreshCatalog() {
    try {
      const response = await fetch("/api/connectors/provision", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { selfConfigurable?: boolean; setupHint?: string | null; providers?: CatalogProvider[] };
      setCatalog({ selfConfigurable: data.selfConfigurable === true, setupHint: data.setupHint ?? null, providers: Array.isArray(data.providers) ? data.providers : [] });
    } catch { /* status remains unknown */ }
  }

  async function refreshServers() {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/connect", { cache: "no-store" });
      const data = await response.json() as { servers?: PublicMcpServer[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Connector directory could not be loaded.");
      setServers(Array.isArray(data.servers) ? data.servers : []);
      setErrors((current) => ({ ...current, directory: "" }));
    } catch (error) {
      setErrors((current) => ({ ...current, directory: error instanceof Error ? error.message : "Connector directory could not be loaded." }));
    } finally { setLoading(false); }
  }

  async function refreshAll() {
    setLoading(true);
    await Promise.all([refreshAccounts(), refreshCatalog(), refreshServers()]);
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    setKeysAreDurable(cloudSyncActive());
    void refreshAll();
  }, [open]);

  if (!open) return null;

  async function disconnectAccount(account: AccountConnector) {
    if (!account.statusPath) return;
    haptic("selection", haptics);
    await fetch(account.statusPath, { method: "DELETE" }).catch(() => {});
    setAccounts((current) => ({ ...current, [account.id]: { connected: false, label: null, oauthAvailable: current[account.id]?.oauthAvailable ?? true, writesEnabled: false } }));
  }

  async function verify(id: string) {
    setVerifying(id);
    try {
      const response = await fetch("/api/connectors/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id }) });
      const data = await response.json() as { ok?: boolean; reason?: string; error?: string };
      setVerified((current) => ({ ...current, [id]: { ok: data.ok === true, reason: data.reason ?? data.error ?? "No answer." } }));
      haptic(data.ok === true ? "success" : "error", haptics);
    } catch {
      setVerified((current) => ({ ...current, [id]: { ok: false, reason: "The test could not run." } }));
    } finally { setVerifying(null); }
  }

  async function provision(provider: CatalogProvider) {
    const value = keyDraft.trim();
    if (!value) return;
    setProvisioning(provider.id);
    setErrors((current) => ({ ...current, [provider.id]: "" }));
    try {
      const response = await fetch("/api/connectors/provision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: provider.id, value }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "That key could not be saved.");
      setKeyDraft("");
      setKeyDraftFor(null);
      haptic("success", haptics);
      await refreshCatalog();
    } catch (error) {
      setErrors((current) => ({ ...current, [provider.id]: error instanceof Error ? error.message : "That key could not be saved." }));
      haptic("error", haptics);
    } finally { setProvisioning(null); }
  }

  async function toggle(server: PublicMcpServer) {
    const connected = preferences.connectedMcpServers.includes(server.id);
    if (connected) {
      update({ connectedMcpServers: preferences.connectedMcpServers.filter((id) => id !== server.id) });
      haptic("selection", haptics);
      return;
    }
    setConnecting(server.id);
    try {
      const response = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: server.id }) });
      const result = await response.json() as { connected?: boolean; error?: string };
      if (!response.ok || !result.connected) throw new Error(result.error || "Connection failed.");
      update({ connectedMcpServers: [...preferences.connectedMcpServers, server.id] });
      haptic("success", haptics);
    } catch (error) {
      setErrors((current) => ({ ...current, [server.id]: error instanceof Error ? error.message : "Connection failed." }));
      haptic("error", haptics);
    } finally { setConnecting(null); }
  }

  async function addCustomConnector() {
    const name = draftName.trim();
    const baseUrl = draftUrl.trim();
    if (!name || !baseUrl) { setAddState({ phase: "error", message: "A name and base URL are required." }); return; }
    if (!baseUrl.startsWith("https://")) { setAddState({ phase: "error", message: "The base URL must start with https://." }); return; }
    if (preferences.customConnectors.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) { setAddState({ phase: "error", message: "A connector with that name already exists." }); return; }
    setAddState({ phase: "testing" });
    try {
      const response = await fetch("/api/connectors/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: draftKind, baseUrl, apiKey: draftKey.trim() }) });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!result.ok) { setAddState({ phase: "error", message: result.error || "The connector did not answer." }); haptic("error", haptics); return; }
    } catch { setAddState({ phase: "error", message: "The connection test could not run." }); haptic("error", haptics); return; }
    const connector: CustomConnector = { id: createId("connector"), kind: draftKind, name, baseUrl, apiKey: draftKey.trim(), model: draftModel.trim() || undefined };
    update({ customConnectors: [...preferences.customConnectors, connector] });
    setDraftName(""); setDraftUrl(""); setDraftKey(""); setDraftModel(""); setAddOpen(false); setAddState({ phase: "idle" });
    haptic("success", haptics);
  }

  function removeCustomConnector(id: string) {
    update({ customConnectors: preferences.customConnectors.filter((entry) => entry.id !== id) });
    haptic("selection", haptics);
  }

  async function discoverApi() {
    const baseUrl = apiUrl.trim();
    if (!baseUrl) return;
    setDiscovery({ phase: "looking" });
    try {
      const response = await fetch("/api/capabilities/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl }) });
      const data = await response.json() as { ok?: boolean; error?: string; detail?: string; manifest?: CapabilityManifest; summary?: { operations: number; reads: number; writes: number; auth: string; truncated?: { declared: number; kept: number } } };
      if (!response.ok || !data.ok || !data.manifest || !data.summary) {
        setDiscovery({ phase: "failed", message: data.error ?? "That could not be read.", detail: data.detail ?? "" });
        haptic("warning", haptics);
        return;
      }
      setDiscovery({ phase: "found", manifest: data.manifest, summary: data.summary });
      haptic("success", haptics);
    } catch { setDiscovery({ phase: "failed", message: "That address could not be reached.", detail: "" }); haptic("error", haptics); }
  }

  function saveApi() {
    if (discovery.phase !== "found") return;
    const manifest = discovery.manifest;
    onPreferences({ ...preferences, capabilities: [...capabilities.filter((entry) => entry?.manifest?.id !== manifest.id), { manifest, apiKey: apiKey.trim(), approvedWrites: [] }] });
    setApiUrl(""); setApiKey(""); setApiOpen(false); setDiscovery({ phase: "idle" });
    haptic("success", haptics);
  }

  function removeApi(id: string) {
    onPreferences({ ...preferences, capabilities: capabilities.filter((entry) => entry?.manifest?.id !== id) });
    haptic("impact-light", haptics);
  }

  return (
    <div className="connectors-dialog fixed inset-0 z-[120] flex flex-col bg-page text-primary" role="dialog" aria-modal="true" aria-label="Connectors">
      <header className="navi-sheet-header sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-page px-2 pb-1 pt-[max(var(--safe-top),env(safe-area-inset-top))]">
        <button type="button" onClick={() => void refreshAll()} disabled={loading} className="flex h-11 w-[82px] items-center justify-start pl-3 text-[15px] font-medium text-accent active:opacity-60 disabled:opacity-50" aria-label="Refresh connectors">
          {loading ? <LoaderCircle size={18} className="animate-spin" /> : <><RefreshCw size={15} className="mr-1.5" />Refresh</>}
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-primary">Connectors</div>
        <button type="button" onClick={onClose} className="flex h-11 w-[82px] items-center justify-end pr-3 text-[16px] font-semibold text-accent active:opacity-60">Done</button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(28px+var(--safe-bottom))]">
        <div className="mx-auto w-full max-w-[680px]">
          <SectionHeader>Access</SectionHeader>
          <Group>
            <DisclosureRow title="Connector access" detail={activeMode.title} open={accessOpen} onToggle={() => setAccessOpen((value) => !value)} leading={<BrandMark id="access" label="Navi" />} />
            {accessOpen ? (
              <div className="border-t border-[var(--border-subtle)]">
                {MODES.map((mode, index) => (
                  <div key={mode.id}>
                    <button type="button" onClick={() => { update({ connectorAccessMode: mode.id }); haptic("selection", haptics); setAccessOpen(false); }} className="connectors-row flex w-full items-center gap-3 bg-transparent px-4 text-left active:bg-elev-2">
                      <span className="w-[30px] shrink-0 text-center text-accent">{preferences.connectorAccessMode === mode.id ? <Check size={18} className="mx-auto" /> : null}</span>
                      <span className="min-w-0 flex-1"><span className="connectors-row-label block font-medium text-primary">{mode.title}</span><span className="connectors-row-description mt-0.5 block text-tertiary">{mode.detail}</span></span>
                    </button>
                    {index < MODES.length - 1 ? <Divider /> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Group>

          <SectionHeader>Connected apps</SectionHeader>
          <Group>
            {ACCOUNTS.map((account, index) => {
              const status = accounts[account.id];
              const connected = status?.connected === true;
              const configurable = Boolean(account.connectPath);
              return (
                <div key={account.id}>
                  <div className="connectors-row flex items-center gap-3 px-4">
                    <BrandMark id={account.id} label={account.name} connected={connected} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2"><span className="connectors-row-label truncate font-medium text-primary">{account.name}</span>{connected ? <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">Connected</span> : null}</div>
                      <div className="connectors-row-description mt-0.5 truncate text-tertiary">{connected ? `${status?.label ? `${status.label} · ` : ""}${status?.writesEnabled && account.writes ? "Read + write" : "Read only"}` : account.detail}</div>
                    </div>
                    {!configurable ? <span className="text-[12px] font-medium text-tertiary">Deployment</span> : connected ? <button type="button" onClick={() => void disconnectAccount(account)} className="connector-action text-danger">Disconnect</button> : status?.oauthAvailable === false ? <span className="text-[12px] text-tertiary">Unavailable</span> : <a href={account.connectPath} className="connector-action flex items-center text-accent">Connect</a>}
                  </div>
                  {index < ACCOUNTS.length - 1 ? <Divider /> : null}
                </div>
              );
            })}
          </Group>

          <SectionHeader>AI providers</SectionHeader>
          <Group>
            <DisclosureRow
              title="Available providers"
              detail={catalog.providers.length ? `${configuredProviders} connected · ${catalog.providers.length} available` : (catalog.setupHint ?? "Loading providers…")}
              open={providersOpen}
              onToggle={() => setProvidersOpen((value) => !value)}
              leading={<BrandMark id="ai" label="AI" connected={configuredProviders > 0} />}
            />
            {providersOpen ? (
              <div className="border-t border-[var(--border-subtle)]">
                {catalog.providers.length ? catalog.providers.map((provider, index) => {
                  const expanded = providerOpen === provider.id || keyDraftFor === provider.id;
                  return (
                    <div key={provider.id}>
                      <button type="button" onClick={() => { setProviderOpen(expanded ? null : provider.id); haptic("selection", haptics); }} className="connectors-row flex w-full items-center gap-3 bg-transparent px-4 text-left active:bg-elev-2" aria-expanded={expanded}>
                        <BrandMark id={provider.id} label={provider.label} connected={provider.configured} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2"><span className="connectors-row-label truncate font-medium text-primary">{provider.label}</span>{provider.free ? <span className="rounded-full bg-elev-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tertiary">Free</span> : null}</div>
                          <div className="connectors-row-description mt-0.5 truncate text-tertiary">{provider.configured ? "Connected" : "Not connected"}</div>
                        </div>
                        <ChevronRight size={17} className={`shrink-0 text-tertiary transition-transform ${expanded ? "rotate-90" : ""}`} />
                      </button>
                      {expanded ? (
                        <div className="border-t border-[var(--border-subtle)] bg-elev-2/30 px-4 py-3 pl-[58px]">
                          <p className="text-[12px] leading-5 text-tertiary">{provider.detail}</p>
                          {verified[provider.id] ? <p className={`mt-1.5 flex items-center gap-1 text-[12px] ${verified[provider.id].ok ? "text-success" : "text-danger"}`}>{verified[provider.id].ok ? <Check size={13} /> : <AlertTriangle size={13} />}{verified[provider.id].reason}</p> : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {provider.configured ? <button type="button" disabled={verifying === provider.id} onClick={() => void verify(provider.id)} className="connector-action bg-elev-2 text-primary disabled:opacity-50">{verifying === provider.id ? "Testing…" : "Test"}</button> : null}
                            <button type="button" onClick={() => { setKeyDraftFor(keyDraftFor === provider.id ? null : provider.id); setKeyDraft(""); }} className="connector-action bg-elev-2 text-accent">{provider.configured ? "Replace key" : "Add key"}</button>
                            <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener" className="connector-action flex items-center bg-elev-2 text-secondary">Get key</a>
                          </div>
                          {keyDraftFor === provider.id ? (
                            <div className="mt-2 space-y-2">
                              <input value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={`Paste ${provider.label} key`} type="password" autoComplete="off" autoCapitalize="none" className="h-9 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-1 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary focus:border-accent" />
                              <button type="button" onClick={() => void provision(provider)} disabled={!keyDraft.trim() || !catalog.selfConfigurable || provisioning === provider.id} className="h-9 rounded-[9px] bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-45">{provisioning === provider.id ? "Saving…" : "Connect"}</button>
                              {errors[provider.id] ? <p className="text-[12px] text-danger">{errors[provider.id]}</p> : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {index < catalog.providers.length - 1 ? <Divider /> : null}
                    </div>
                  );
                }) : <div className="px-4 py-3 text-[13px] text-tertiary">No provider catalog is available yet.</div>}
              </div>
            ) : null}
          </Group>

          <SectionHeader>Advanced</SectionHeader>
          <Group>
            <DisclosureRow title="Advanced connections" detail={`${preferences.connectedMcpServers.length} MCP · ${customCount} custom`} open={advancedOpen} onToggle={() => setAdvancedOpen((value) => !value)} leading={<BrandMark id="advanced" label="API" />} />
            {advancedOpen ? (
              <div className="border-t border-[var(--border-subtle)]">
                <DisclosureRow title="Remote MCP servers" detail={servers.length ? `${servers.length} available` : "None configured"} open={mcpOpen} onToggle={() => setMcpOpen((value) => !value)} leading={<span className="brand-mark flex shrink-0 items-center justify-center text-secondary"><Server size={17} /></span>} />
                {mcpOpen ? (
                  <div className="border-y border-[var(--border-subtle)] bg-elev-2/20">
                    {errors.directory ? <div className="px-4 py-2 text-[12px] text-danger">{errors.directory}</div> : null}
                    {servers.length ? servers.map((server, index) => {
                      const connected = preferences.connectedMcpServers.includes(server.id);
                      return <div key={server.id}><div className="connectors-row flex items-center gap-3 px-4 pl-[58px]"><div className="min-w-0 flex-1"><div className="connectors-row-label truncate text-primary">{server.name}</div><div className="connectors-row-description truncate text-tertiary">{server.readOnly ? "Read only" : "Writes ask first"}</div></div>{connecting === server.id ? <LoaderCircle size={17} className="animate-spin text-accent" /> : <CompactToggle value={connected} label={`${connected ? "Disconnect" : "Connect"} ${server.name}`} onChange={() => void toggle(server)} />}</div>{index < servers.length - 1 ? <Divider /> : null}</div>;
                    }) : <div className="px-4 py-3 pl-[58px] text-[12px] text-tertiary">No remote servers yet.</div>}
                  </div>
                ) : null}

                <DisclosureRow title="Custom APIs" detail={customCount ? `${customCount} connected` : (keysAreDurable ? "Keys can sync to your account" : "Keys stay in this browser")} open={customOpen} onToggle={() => setCustomOpen((value) => !value)} leading={<span className="brand-mark flex shrink-0 items-center justify-center text-secondary"><Link2 size={17} /></span>} />
                {customOpen ? (
                  <div className="border-t border-[var(--border-subtle)] bg-elev-2/20">
                    {preferences.customConnectors.map((connector) => <div key={connector.id} className="connectors-row flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 pl-[58px]"><div className="min-w-0 flex-1"><div className="connectors-row-label truncate text-primary">{connector.name}</div><div className="connectors-row-description truncate text-tertiary">{CONNECTOR_KINDS.find((kind) => kind.id === connector.kind)?.label ?? connector.kind} · {hostOf(connector.baseUrl)}</div></div><button type="button" onClick={() => removeCustomConnector(connector.id)} className="flex h-8 w-8 items-center justify-center text-danger"><Trash2 size={16} /></button></div>)}
                    {capabilities.map((entry) => <div key={entry.manifest.id} className="connectors-row flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 pl-[58px]"><div className="min-w-0 flex-1"><div className="connectors-row-label truncate text-primary">{entry.manifest.name}</div><div className="connectors-row-description truncate text-tertiary">{entry.manifest.operations.length} operations · {hostOf(entry.manifest.baseUrl)}</div></div><button type="button" onClick={() => removeApi(entry.manifest.id)} className="flex h-8 w-8 items-center justify-center text-danger"><Trash2 size={16} /></button></div>)}
                    <button type="button" onClick={() => setApiOpen(true)} className="connectors-row flex w-full items-center gap-2 px-4 pl-[58px] text-left text-[13px] font-medium text-accent active:bg-elev-2"><Plus size={16} />Discover API</button>
                    <button type="button" onClick={() => setAddOpen(true)} className="connectors-row flex w-full items-center gap-2 border-t border-[var(--border-subtle)] px-4 pl-[58px] text-left text-[13px] font-medium text-accent active:bg-elev-2"><Plus size={16} />Manual connector</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Group>

          {addOpen ? (
            <Group>
              <div className="space-y-2 p-3">
                <div className="mb-1 flex items-center justify-between"><h4 className="text-[14px] font-semibold text-primary">Manual connector</h4><button type="button" onClick={() => setAddOpen(false)} className="flex h-8 w-8 items-center justify-center text-tertiary"><X size={17} /></button></div>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-tertiary">Type</span><span className="relative block"><select value={draftKind} onChange={(event) => { setDraftKind(event.target.value as CustomConnectorKind); setAddState({ phase: "idle" }); }} className="h-10 w-full appearance-none rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 pr-10 text-[13px] text-primary outline-none">{CONNECTOR_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary" /></span></label>
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Name" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" />
                <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder={CONNECTOR_KINDS.find((kind) => kind.id === draftKind)?.urlHint || "https://…"} inputMode="url" autoCapitalize="none" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" />
                <input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder={draftKind === "supabase" ? "Anon key" : "API key"} type="password" autoComplete="off" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" />
                {CONNECTOR_KINDS.find((kind) => kind.id === draftKind)?.needsModel ? <input value={draftModel} onChange={(event) => setDraftModel(event.target.value)} placeholder="Default model (optional)" autoCapitalize="none" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" /> : null}
                {addState.phase === "error" ? <p className="text-[12px] text-danger">{addState.message}</p> : null}
                <button type="button" onClick={() => void addCustomConnector()} disabled={addState.phase === "testing"} className="h-10 w-full rounded-[9px] bg-accent text-[13px] font-semibold text-white disabled:opacity-45">{addState.phase === "testing" ? "Testing…" : "Test & add"}</button>
              </div>
            </Group>
          ) : null}

          {apiOpen ? (
            <Group>
              <div className="space-y-2 p-3">
                <div className="mb-1 flex items-center justify-between"><h4 className="text-[14px] font-semibold text-primary">Discover API</h4><button type="button" onClick={() => { setApiOpen(false); setDiscovery({ phase: "idle" }); }} className="flex h-8 w-8 items-center justify-center text-tertiary"><X size={17} /></button></div>
                <input value={apiUrl} onChange={(event) => { setApiUrl(event.target.value); setDiscovery({ phase: "idle" }); }} placeholder="https://api.example.com" inputMode="url" autoCapitalize="none" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" />
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key (optional)" type="password" autoCapitalize="none" className="h-10 w-full rounded-[9px] border border-[var(--border-subtle)] bg-elev-2 px-3 text-[13px] text-primary outline-none placeholder:text-tertiary" />
                {discovery.phase === "failed" ? <div className="rounded-[9px] bg-danger/10 p-2.5 text-[12px] text-danger"><div className="font-medium">{discovery.message}</div>{discovery.detail ? <div className="mt-1 break-all opacity-80">{discovery.detail}</div> : null}</div> : null}
                {discovery.phase === "found" ? <div className="rounded-[9px] border border-accent/20 bg-accent/5 p-3"><div className="text-[14px] font-semibold text-primary">{discovery.manifest.name}</div><div className="mt-1 text-[12px] text-tertiary">{discovery.summary.operations} operations · {discovery.summary.reads} reads{discovery.summary.writes ? ` · ${discovery.summary.writes} writes` : ""}</div>{discovery.summary.truncated ? <div className="mt-1 text-[12px] text-warning">Keeping the first {discovery.summary.truncated.kept} of {discovery.summary.truncated.declared} declared operations.</div> : null}<button type="button" onClick={saveApi} className="mt-2 h-9 rounded-[9px] bg-accent px-4 text-[13px] font-semibold text-white"><Check size={14} className="mr-1 inline" />Add API</button></div> : <button type="button" onClick={() => void discoverApi()} disabled={discovery.phase === "looking" || !apiUrl.trim()} className="h-10 w-full rounded-[9px] bg-accent text-[13px] font-semibold text-white disabled:opacity-45">{discovery.phase === "looking" ? "Reading API…" : "Read API"}</button>}
              </div>
            </Group>
          ) : null}

          <p className="mx-4 mt-5 text-center text-[11px] leading-4 text-tertiary">Keys stay private to your workspace. Sensitive writes still require confirmation.</p>
        </div>
      </main>
    </div>
  );
}
