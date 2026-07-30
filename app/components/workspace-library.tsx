"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Boxes, Cable, FileText, FolderKanban, MessageSquare, Plus, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";
import type { NaviPreferences, NaviProject, StoredChat } from "@/lib/ai/types";
import { DEFAULT_PREFERENCES, MODEL_PRESETS, RESPONSE_STYLES, chatPreview, createId, messageText, sortChats } from "@/lib/chat";
import { clearLocalState, loadLocalState, setLocalValue } from "@/lib/storage/indexeddb";
import { persistThemeCookie } from "@/lib/ui/theme-cookie";
import { NaviMark } from "./navi-mark";
import "./workspace-library.css";

type WorkspaceView = "recents" | "projects" | "artifacts" | "connectors" | "customize" | "settings";
type Server = { id: string; name: string; url: string; configured: true };
type Artifact = { id: string; title: string; kind: string; chat: StoredChat };
const official = ["Google Drive", "Gmail", "Google Calendar", "Slack"];
const copy: Record<WorkspaceView, [string, string, string]> = {
  recents: ["Your conversations", "Recents", "Pick up where you left off, or begin a fresh thread."], projects: ["Focused work", "Projects", "Keep instructions and knowledge close to related conversations."], artifacts: ["Made with Navi", "Artifacts", "Reusable tools and documents made in your chats."], connectors: ["Your context", "Connectors", "Connect only the configured sources you want Navi to use."], customize: ["Make it yours", "Customize", "Tune the model, response style, and tools Navi reaches for."], settings: ["NaviOS Hub on this device", "Settings", "Review local preferences and your stored workspace data."]
};
function ago(t: number) { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; }
function resolvedTheme(preference: NaviPreferences["theme"]): "dark" | "light" {
  if (preference === "system") return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return preference;
}
function Empty({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><Sparkles size={25} /><h2>{title}</h2><p>{body}</p><Link href="/new" className="workspace-primary"><Plus size={16} />Start a new chat</Link></div>; }
function artifacts(chats: StoredChat[]): Artifact[] { return chats.flatMap((chat) => chat.messages.flatMap((message) => { const text = messageText(message); return [...text.matchAll(/```navi-artifact\s*([\s\S]*?)```/gi)].flatMap((match, index) => { try { const value = JSON.parse(match[1]) as { id?: string; title?: string; kind?: string }; return typeof value.title === "string" ? [{ id: value.id || `${chat.id}-${index}`, title: value.title, kind: value.kind || "artifact", chat }] : []; } catch { return []; } }); })); }

function ChatList({ chats }: { chats: StoredChat[] }) { const [query, setQuery] = useState(""); const results = useMemo(() => sortChats(chats).filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(query.toLowerCase())), [chats, query]); return <><label className="workspace-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" /></label>{results.length ? <div className="workspace-list">{results.map((c) => <Link className="workspace-row" href={`/chat/${encodeURIComponent(c.id)}`} key={c.id}><span className="workspace-row-icon"><MessageSquare size={18} /></span><span className="workspace-row-copy"><strong>{c.title}</strong><small>{chatPreview(c.messages) || c.preview}</small></span><time>{ago(c.updatedAt)}</time><ArrowRight size={16} /></Link>)}</div> : <Empty title={query ? "No matching conversations" : "No conversations yet"} body="Saved chats will appear here." />}</>; }

function ProjectList({ projects, chats, save }: { projects: NaviProject[]; chats: StoredChat[]; save: (next: NaviProject[]) => void }) { const [editing, setEditing] = useState<NaviProject | null>(null); const [name, setName] = useState(""); const [instructions, setInstructions] = useState(""); const open = (p?: NaviProject) => { setEditing(p || { id: createId("project"), name: "", instructions: "", knowledge: [], createdAt: Date.now(), updatedAt: Date.now(), syncState: "local" }); setName(p?.name || ""); setInstructions(p?.instructions || ""); }; const submit = () => { if (!editing || !name.trim()) return; const next = { ...editing, name: name.trim(), instructions: instructions.trim(), updatedAt: Date.now() }; save([next, ...projects.filter((p) => p.id !== next.id)]); setEditing(null); }; return <><button className="workspace-primary workspace-add" onClick={() => open()}><Plus size={16} />New project</button>{projects.length ? <div className="workspace-list">{projects.map((p) => <article className="workspace-row workspace-card" key={p.id}><span className="workspace-row-icon"><FolderKanban size={18} /></span><span className="workspace-row-copy"><strong>{p.name}</strong><small>{p.instructions || "No project instructions yet"}</small><em>{p.knowledge.length} knowledge items · {chats.filter((c) => c.projectId === p.id).length} chats</em></span><button className="workspace-icon-button" onClick={() => open(p)} aria-label={`Edit ${p.name}`}><Settings2 size={16} /></button><button className="workspace-icon-button danger" onClick={() => save(projects.filter((item) => item.id !== p.id))} aria-label={`Delete ${p.name}`}><Trash2 size={16} /></button></article>)}</div> : <Empty title="Start a focused project" body="Projects hold reusable instructions and knowledge." />}{editing ? <div className="workspace-modal"><form className="workspace-dialog" onSubmit={(e) => { e.preventDefault(); submit(); }}><button type="button" className="workspace-close" onClick={() => setEditing(null)} aria-label="Close project editor"><X size={18} /></button><h2>{projects.some((p) => p.id === editing.id) ? "Edit project" : "New project"}</h2><label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Research launch" /></label><label>Instructions<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="How should Navi approach this work?" /></label><button className="workspace-primary" type="submit">Save project</button></form></div> : null}</>; }

function ArtifactList({ chats }: { chats: StoredChat[] }) { const results = artifacts(chats); return results.length ? <div className="workspace-list">{results.map((a) => <Link className="workspace-row" href={`/chat/${encodeURIComponent(a.chat.id)}`} key={`${a.chat.id}-${a.id}`}><span className="workspace-row-icon"><FileText size={18} /></span><span className="workspace-row-copy"><strong>{a.title}</strong><small>{a.kind} · Source: {a.chat.title}</small></span><ArrowRight size={16} /></Link>)}</div> : <Empty title="No artifacts to show" body="Artifacts appear here when a chat contains a valid Navi artifact payload." />; }

function Connectors({ preferences, save }: { preferences: NaviPreferences; save: (p: NaviPreferences) => void }) { const [servers, setServers] = useState<Server[]>([]); const [note, setNote] = useState(""); useEffect(() => { void fetch("/api/mcp/connect").then((r) => r.ok ? r.json() : { servers: [] }).then((data: { servers?: Server[] }) => setServers(data.servers || [])).catch(() => setServers([])); }, []); const toggle = async (server: Server) => { const connected = preferences.connectedMcpServers.includes(server.id); if (connected) { save({ ...preferences, connectedMcpServers: preferences.connectedMcpServers.filter((id) => id !== server.id) }); return; } setNote(`Checking ${server.name}…`); try { const response = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: server.id }) }); const data = await response.json() as { connected?: boolean; error?: string }; if (!response.ok || !data.connected) throw new Error(data.error || "Could not connect."); save({ ...preferences, connectedMcpServers: [...preferences.connectedMcpServers, server.id] }); setNote(`${server.name} connected.`); } catch (error) { setNote(error instanceof Error ? error.message : "Could not connect."); } }; return <><p className="workspace-note">{note || "Configured servers are verified before they are added. Catalog entries below are availability placeholders."}</p><div className="workspace-list">{servers.map((s) => { const on = preferences.connectedMcpServers.includes(s.id); return <div className="workspace-row workspace-card" key={s.id}><span className="workspace-row-icon"><Cable size={18} /></span><span className="workspace-row-copy"><strong>{s.name}</strong><small>{s.url}</small></span><button className={on ? "workspace-toggle on" : "workspace-toggle"} onClick={() => void toggle(s)} aria-pressed={on} aria-label={`${on ? "Disconnect" : "Connect"} ${s.name}`}>{on ? "Disconnect" : "Connect"}</button></div>; })}{!servers.length ? <div className="workspace-empty compact"><Cable size={22} /><h2>No configured connectors</h2><p>Add server configuration to make a connector available here.</p></div> : null}{official.map((name) => <div className="workspace-row workspace-card" key={name}><span className="workspace-row-icon"><Cable size={18} /></span><span className="workspace-row-copy"><strong>{name}</strong><small>Official connector catalog · not configured</small></span><span className="workspace-status">Available soon</span></div>)}</div></>; }

const VOICE_LANGUAGES = [
  ["auto", "Match device"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["he-IL", "Hebrew"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["pt-BR", "Portuguese (BR)"],
  ["ja-JP", "Japanese"]
] as const;

function PreferenceControls({ view, preferences, save, clear, onExport }: { view: WorkspaceView; preferences: NaviPreferences; save: (p: NaviPreferences) => void; clear: () => void; onExport: () => void }) {
  const [voiceLanguage, setVoiceLanguage] = useState(() => (typeof window === "undefined" ? "auto" : localStorage.getItem("navi.voice.language.v1") || "auto"));

  const updateVoiceLanguage = (value: string) => {
    setVoiceLanguage(value);
    if (value === "auto") localStorage.removeItem("navi.voice.language.v1");
    else localStorage.setItem("navi.voice.language.v1", value);
  };

  if (view === "customize") {
    return (
      <div className="workspace-list">
        <label className="workspace-control">
          Response style
          <select value={preferences.style} onChange={(event) => save({ ...preferences, style: event.target.value as NaviPreferences["style"] })}>
            {RESPONSE_STYLES.map((style) => <option value={style.id} key={style.id}>{style.label}</option>)}
          </select>
        </label>
        <label className="workspace-control">
          Model
          <select value={preferences.preset} onChange={(event) => save({ ...preferences, preset: event.target.value as NaviPreferences["preset"] })}>
            {MODEL_PRESETS.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
          </select>
        </label>
        {(["web", "code", "artifacts"] as const).map((tool) => (
          <label className="workspace-switch" key={tool}>
            <span>
              <strong>{tool === "web" ? "Web research" : tool === "code" ? "Code tools" : "Artifacts"}</strong>
              <small>{preferences.tools[tool] ? "Enabled" : "Disabled"}</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.tools[tool]}
              onChange={() => save({ ...preferences, tools: { ...preferences.tools, [tool]: !preferences.tools[tool] } })}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="workspace-list">
      <label className="workspace-switch">
        <span><strong>Save history</strong><small>Keep conversations for this account in this browser</small></span>
        <input type="checkbox" checked={preferences.saveHistory} onChange={() => save({ ...preferences, saveHistory: !preferences.saveHistory })} />
      </label>
      <label className="workspace-control">
        Theme
        <select value={preferences.theme} onChange={(event) => save({ ...preferences, theme: event.target.value as NaviPreferences["theme"] })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="workspace-control">
        Motion
        <select value={preferences.motion} onChange={(event) => save({ ...preferences, motion: event.target.value as NaviPreferences["motion"] })}>
          <option value="full">Full</option>
          <option value="reduced">Reduced</option>
        </select>
      </label>
      <label className="workspace-switch">
        <span><strong>Haptics</strong><small>Feedback for supported interactions</small></span>
        <input type="checkbox" checked={preferences.haptics} onChange={() => save({ ...preferences, haptics: !preferences.haptics })} />
      </label>
      <label className="workspace-control">
        Voice language
        <select value={voiceLanguage} onChange={(event) => updateVoiceLanguage(event.target.value)}>
          {VOICE_LANGUAGES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
      </label>
      <div className="workspace-switch">
        <span><strong>Export your data</strong><small>Download chats, projects, and preferences as JSON</small></span>
        <button className="workspace-toggle" onClick={onExport}>Export</button>
      </div>
      <div className="workspace-switch">
        <span><strong>About</strong><small>NaviOS Hub 3.1 · local-first private workspace · all data stays on this device</small></span>
      </div>
      <button className="workspace-danger" onClick={clear}>Clear this account&apos;s local workspace data</button>
    </div>
  );
}

export function WorkspaceLibrary({ view }: { view: WorkspaceView }) {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [projects, setProjects] = useState<NaviProject[]>([]);
  const [preferences, setPreferences] = useState<NaviPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  const persistProjects = (next: NaviProject[]) => {
    setProjects(next);
    void setLocalValue("projects", next);
  };
  const persistPreferences = (next: NaviPreferences) => {
    setPreferences(next);
    void setLocalValue("preferences", next);
  };
  const clear = () => {
    if (!window.confirm("Clear all local Navi chats, projects, preferences, and drafts for this account on this device?")) return;
    void clearLocalState().then(() => {
      setChats([]);
      setProjects([]);
      setPreferences(DEFAULT_PREFERENCES);
    });
  };

  useEffect(() => {
    void loadLocalState()
      .then((state) => {
        setChats(state.chats);
        setProjects(state.projects);
        setPreferences(state.preferences);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const apply = () => {
      const next = resolvedTheme(preferences.theme);
      document.documentElement.dataset.theme = next;
      document.documentElement.dataset.motion = preferences.motion;
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("navi.theme.v3", next);
      persistThemeCookie(next);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.motion, preferences.theme]);

  const exportData = () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), chats, projects, preferences }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `navi-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const [eyebrow, title, description] = copy[view];
  const content = !loaded
    ? <div className="workspace-loading">Loading your workspace…</div>
    : view === "recents"
      ? <ChatList chats={chats} />
      : view === "projects"
        ? <ProjectList projects={projects} chats={chats} save={persistProjects} />
        : view === "artifacts"
          ? <ArtifactList chats={chats} />
          : view === "connectors"
            ? <Connectors preferences={preferences} save={persistPreferences} />
            : <PreferenceControls view={view} preferences={preferences} save={persistPreferences} clear={clear} onExport={exportData} />;

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link href="/new" className="workspace-mark" aria-label="New chat">
          <NaviMark className="h-8 w-8" />
        </Link>
        <div><p>{eyebrow}</p><h1>{title}</h1></div>
        <Link href="/new" className="workspace-new"><Plus size={17} /><span>New chat</span></Link>
      </header>
      <section className="workspace-intro"><p>{description}</p></section>
      {content}
      <nav className="workspace-nav" aria-label="Workspace">
        <Link href="/recents" aria-current={view === "recents" ? "page" : undefined}><BookOpen size={17} />Recents</Link>
        <Link href="/projects" aria-current={view === "projects" ? "page" : undefined}><FolderKanban size={17} />Projects</Link>
        <Link href="/artifacts" aria-current={view === "artifacts" ? "page" : undefined}><Boxes size={17} />Artifacts</Link>
        <Link href="/connectors" aria-current={view === "connectors" ? "page" : undefined}><Cable size={17} />Connectors</Link>
      </nav>
    </main>
  );
}
