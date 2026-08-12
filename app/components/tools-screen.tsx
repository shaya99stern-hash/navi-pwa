"use client";

import { Braces, Github, Mail, Plus, Search, Shapes } from "lucide-react";
import type { NaviPreferences } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";

/**
 * What Navi Soul may reach for, and what has been plugged in.
 *
 * Default-deny is the rule the screen is built to make visible: a tool that is
 * off does not run, and the switch says so at a glance rather than being
 * buried three levels into Settings.
 */

function Toggle({
  on,
  label,
  onChange,
  haptics
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
  haptics: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => { haptic("impact-medium", haptics); onChange(!on); }}
      className={`flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${
        on ? "justify-end bg-accent" : "justify-start bg-elev-3"
      }`}
    >
      <span className={`h-[27px] w-[27px] rounded-full ${on ? "bg-white shadow-[0_2px_5px_rgba(0,0,0,.3)]" : "bg-[var(--text-tertiary)]"}`} />
    </button>
  );
}

function ToolCard({
  Icon,
  tint,
  wash,
  name,
  detail,
  detailTone,
  children
}: {
  Icon: typeof Search;
  tint: string;
  wash: string;
  name: string;
  detail: string;
  detailTone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-surface p-3.5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]" style={{ background: wash }}>
        <Icon size={17} strokeWidth={1.9} style={{ color: tint }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.90625rem]/[1.1875rem] font-semibold text-primary">{name}</span>
        <span className={`mt-0.5 block text-[0.78125rem]/[1.09375rem] font-normal ${detailTone === "warn" ? "text-danger" : "text-tertiary"}`}>
          {detail}
        </span>
      </span>
      {children}
    </div>
  );
}

export function ToolsScreen({
  preferences,
  onPreferences,
  onConnectors,
  onArtifacts
}: {
  preferences: NaviPreferences;
  onPreferences: (preferences: NaviPreferences) => void;
  onConnectors: () => void;
  onArtifacts: () => void;
}) {
  const haptics = preferences.haptics;
  const setTool = (key: keyof NaviPreferences["tools"], value: boolean) =>
    onPreferences({ ...preferences, tools: { ...preferences.tools, [key]: value } });

  const connected = preferences.connectedMcpServers;
  const custom = preferences.customConnectors;

  return (
    <div className="navi-screen min-h-full px-gutter pb-6 pt-3.5">
      <div className="mx-auto w-full max-w-app">
        <h2 className="font-display text-[1.625rem]/8 tracking-[-0.02em] text-primary">Tools</h2>
        <p className="mb-4 mt-1.5 max-w-[34ch] text-[0.84375rem]/[1.265rem] font-normal text-tertiary">
          What Navi Soul may reach for. Default-deny: nothing runs unless it is on.
        </p>

        <div className="flex flex-col gap-2">
          <ToolCard
            Icon={Search}
            tint="var(--accent-info)"
            wash="rgba(106,155,204,.16)"
            name="Web research"
            detail="Searches the open web when a question needs it"
          >
            <Toggle on={preferences.tools.web} label="Web research" haptics={haptics} onChange={(next) => setTool("web", next)} />
          </ToolCard>

          <ToolCard
            Icon={Braces}
            tint="var(--accent-success)"
            wash="rgba(123,174,127,.16)"
            name="Run JavaScript"
            detail="On-device sandbox · fails closed"
          >
            <Toggle on={preferences.tools.code} label="Run JavaScript" haptics={haptics} onChange={(next) => setTool("code", next)} />
          </ToolCard>

          <ToolCard
            Icon={Shapes}
            tint="var(--accent-warning)"
            wash="rgba(212,162,127,.16)"
            name="Artifacts"
            detail="Interactive pages, run in a sandboxed frame"
          >
            <Toggle on={preferences.tools.artifacts} label="Artifacts" haptics={haptics} onChange={(next) => setTool("artifacts", next)} />
          </ToolCard>

          <ToolCard
            Icon={Github}
            tint="var(--text-tertiary)"
            wash="rgba(155,154,145,.14)"
            name="GitHub"
            detail={connected.includes("github") ? "Connected" : "Not connected"}
          >
            <button
              type="button"
              onClick={() => { haptic("selection", haptics); onConnectors(); }}
              className="shrink-0 rounded-full border border-[var(--border-strong)] px-3 py-2 text-[0.78125rem]/[0.9375rem] font-semibold text-secondary active:bg-elev-2"
            >
              {connected.includes("github") ? "Manage" : "Connect"}
            </button>
          </ToolCard>

          <ToolCard
            Icon={Mail}
            tint="var(--text-tertiary)"
            wash="rgba(155,154,145,.14)"
            name="Gmail & Calendar"
            detail={connected.includes("google") ? "Connected" : "Not connected"}
          >
            <button
              type="button"
              onClick={() => { haptic("selection", haptics); onConnectors(); }}
              className="shrink-0 rounded-full border border-[var(--border-strong)] px-3 py-2 text-[0.78125rem]/[0.9375rem] font-semibold text-secondary active:bg-elev-2"
            >
              {connected.includes("google") ? "Manage" : "Connect"}
            </button>
          </ToolCard>
        </div>

        <div className="mb-2.5 ml-0.5 mt-[26px] flex items-baseline gap-2.5">
          <span className="text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.1em] text-tertiary">Plugins</span>
          <span className="text-[0.71875rem]/[0.9375rem] font-normal text-disabled">Any MCP server</span>
        </div>

        <div className="flex flex-col gap-2">
          {custom.map((connector) => (
            <div key={connector.id} className="flex items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-surface p-3.5">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--selection-bg)]">
                <Shapes size={17} strokeWidth={1.9} className="text-accent" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.90625rem]/[1.1875rem] font-semibold text-primary">{connector.name}</span>
                <span className="mt-0.5 block truncate text-[0.78125rem]/[1.09375rem] font-normal text-tertiary">
                  {connector.kind.toUpperCase()} · {preferences.connectorAccessMode}
                </span>
              </span>
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: connected.includes(connector.id) ? "var(--accent-success)" : "var(--text-disabled)" }}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={() => { haptic("selection", haptics); onConnectors(); }}
            className="flex w-full items-center gap-3 rounded-[16px] border border-dashed border-[var(--border-strong)] p-3.5 text-left active:bg-surface"
          >
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-dashed border-[var(--border-strong)]">
              <Plus size={18} strokeWidth={2} className="text-accent" />
            </span>
            <span className="flex-1">
              <span className="block text-[0.90625rem]/[1.1875rem] font-semibold text-primary">Add a plugin</span>
              <span className="mt-0.5 block text-[0.78125rem]/[1.09375rem] font-normal text-tertiary">Paste any MCP server URL</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => { haptic("selection", haptics); onArtifacts(); }}
            className="mt-1 min-h-11 w-full rounded-full border border-[var(--border-strong)] px-4 text-[0.84375rem]/[1.25rem] font-semibold text-secondary active:bg-elev-2"
          >
            Open the artifact library
          </button>
        </div>
      </div>
    </div>
  );
}
