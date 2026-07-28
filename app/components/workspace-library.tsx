"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, Boxes, Brain, Cable, Check, CircleUserRound, Clock3, FileText, FolderKanban, LockKeyhole, MessageSquare, Plus, Puzzle, Search, Settings2, ShieldCheck, Sparkles, Trash2, UserRound, WandSparkles, X } from "lucide-react";
import type { NaviPreferences, NaviProject, StoredChat } from "@/lib/ai/types";
import { DEFAULT_PREFERENCES, MODEL_PRESETS, RESPONSE_STYLES, chatPreview, createId, messageText, sortChats } from "@/lib/chat";
import { clearLocalState, loadLocalState, setLocalValue } from "@/lib/storage/indexeddb";
import { NaviMark } from "./navi-mark";
import "./workspace-library.css";

type WorkspaceView = "recents" | "projects" | "artifacts" | "connectors" | "customize" | "settings";
type Server = { id: string; name: string; url: string; configured: true };
type Artifact = { id: string; title: string; kind: string; chat: StoredChat };
type SettingsTab = "General" | "Account" | "Privacy" | "Capabilities" | "Reflect" | "Time and focus" | "Skills" | "Connectors" | "Plugins" | "Memory";

const officialConnectors = ["Google Drive", "Gmail", "Google Calendar", "Slack"];
const settingsTabs: SettingsTab[] = ["General", "Account", "Privacy", "Capabilities", "Reflect", "Time and focus", "Skills", "Connectors", "Plugins", "Memory"];
const copy: Record<WorkspaceView, [string, string, string]> = {
  recents: ["Your conversations", "Chats", "Search your saved chats or start a new conversation."],
  projects: ["Focused work", "Projects", "Keep instructions and knowledge available across related chats."],
  artifacts: ["Made with Navi", "Artifacts", "Build reusable documents and tools in a chat, then find them here."],
  connectors: ["Your context", "Connectors", "Only configured sources can be connected and used by Navi."],
  customize: ["Make it yours", "Customize", "Choose how Navi responds and which locally available tools it may use."],
  settings: ["Navi on this device", "Settings", "Review local preferences, privacy, and workspace data."],
};

function ago(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
}

function resolvedTheme(preference: NaviPreferences["theme"]): "dark" | "light" {
  if (preference === "system") return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return preference;
}

function Empty({ title, body, action = "Start a new chat", href = "/new", onAction, icon: Icon = Sparkles }: { title: string; body: string; action?: string; href?: string; onAction?: () => void; icon?: typeof Sparkles }) {
  const actionContent = <><Plus size={16} />{action}</>;
  return <div className="workspace-empty"><Icon size={26} /><h2>{title}</h2><p>{body}</p>{onAction ? <button type="button" className="workspace-primary" onClick={onAction}>{actionContent}</button> : <Link href={href} className="workspace-primary">{actionContent}</Link>}</div>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="workspace-search"><Search size={17} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

function artifacts(chats: StoredChat[]): Artifact[] {
  return chats.flatMap((chat) => chat.messages.flatMap((message) => {
    const text = messageText(message);
    return [...text.matchAll(/```navi-artifact\s*([\s\S]*?)```/gi)].flatMap((match, index) => {
      try {
        const value = JSON.parse(match[1]) as { id?: string; title?: string; kind?: string };
        return typeof value.title === "string" ? [{ id: value.id || `${chat.id}-${index}`, title: value.title, kind: value.kind || "artifact", chat }] : [];
      } catch {
        return [];
      }
    });
  }));
}

function ChatList({ chats }: { chats: StoredChat[] }) {
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const results = useMemo(() => sortChats(chats).filter((chat) => `${chat.title} ${chat.preview}`.toLowerCase().includes(query.toLowerCase())), [chats, query]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const finishSelecting = () => { setSelecting(false); setSelected([]); };

  return <>
    <div className="workspace-actions">
      <SearchField value={query} onChange={setQuery} placeholder="Search chats" />
      <div className="workspace-toolbar">
        <button type="button" className="workspace-filter" aria-label="Chat filter">All chats</button>
        <button type="button" className="workspace-text-button" onClick={() => selecting ? finishSelecting() : setSelecting(true)}>{selecting ? "Done" : "Select chats"}</button>
      </div>
    </div>
    {selecting && results.length ? <p className="workspace-selection-note">{selected.length ? `${selected.length} selected` : "Choose chats to review"}</p> : null}
    {results.length ? <div className="workspace-list">{results.map((chat) => selecting
      ? <button type="button" className="workspace-row workspace-selectable" key={chat.id} onClick={() => toggle(chat.id)} aria-pressed={selected.includes(chat.id)}><span className={selected.includes(chat.id) ? "workspace-checkbox checked" : "workspace-checkbox"}>{selected.includes(chat.id) ? <Check size={14} /> : null}</span><span className="workspace-row-icon"><MessageSquare size={18} /></span><span className="workspace-row-copy"><strong>{chat.title}</strong><small>{chatPreview(chat.messages) || chat.preview}</small></span><time>{ago(chat.updatedAt)}</time></button>
      : <Link className="workspace-row" href={`/chat/${encodeURIComponent(chat.id)}`} key={chat.id}><span className="workspace-row-icon"><MessageSquare size={18} /></span><span className="workspace-row-copy"><strong>{chat.title}</strong><small>{chatPreview(chat.messages) || chat.preview}</small></span><time>{ago(chat.updatedAt)}</time><ArrowRight size={16} /></Link>
    )}</div> : <Empty title={query ? "No matching chats" : "No chats yet"} body={query ? "Try a different search, or start a new chat." : "Your conversations will appear here after you send your first message."} action="New chat" icon={MessageSquare} />}
  </>;
}

function ProjectEditor({ project, existing, onClose, onSave }: { project: NaviProject; existing: boolean; onClose: () => void; onSave: (project: NaviProject) => void }) {
  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions);
  const [knowledge, setKnowledge] = useState(project.knowledge);
  const [knowledgeDraft, setKnowledgeDraft] = useState("");
  const addKnowledge = () => {
    const value = knowledgeDraft.trim();
    if (!value || knowledge.includes(value)) return;
    setKnowledge((current) => [...current, value]);
    setKnowledgeDraft("");
  };
  const submit = () => {
    if (!name.trim()) return;
    onSave({ ...project, name: name.trim(), instructions: instructions.trim(), knowledge, updatedAt: Date.now() });
  };

  return <div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="project-editor-title"><form className="workspace-dialog" onSubmit={(event) => { event.preventDefault(); submit(); }}><button type="button" className="workspace-close" onClick={onClose} aria-label="Close project editor"><X size={18} /></button><p className="workspace-dialog-eyebrow">{existing ? "Project details" : "New project"}</p><h2 id="project-editor-title">{existing ? "Edit project" : "Create a project"}</h2><label>Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Research launch" /></label><label>Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="How should Navi approach this work?" /></label><div className="workspace-knowledge"><div><strong>Project knowledge</strong><small>Local notes are sent as durable context when this project is selected.</small></div><div className="workspace-knowledge-add"><textarea value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder="Add a requirement, source note, or decision" /><button type="button" className="workspace-icon-button workspace-add-knowledge" onClick={addKnowledge} disabled={!knowledgeDraft.trim()} aria-label="Add project knowledge"><Plus size={17} /></button></div>{knowledge.length ? <ul>{knowledge.map((item, index) => <li key={`${item}-${index}`}><span>{item}</span><button type="button" className="workspace-icon-button danger" onClick={() => setKnowledge((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove knowledge item"><Trash2 size={15} /></button></li>)}</ul> : <p className="workspace-muted">No project knowledge yet.</p>}</div><button className="workspace-primary" type="submit">{existing ? "Save changes" : "Create project"}</button></form></div>;
}

function ProjectList({ projects, chats, save }: { projects: NaviProject[]; chats: StoredChat[]; save: (next: NaviProject[]) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "created">("updated");
  const [editing, setEditing] = useState<NaviProject | null>(null);
  const ordered = useMemo(() => projects.filter((project) => `${project.name} ${project.instructions} ${project.knowledge.join(" ")}`.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt), [projects, query, sort]);
  const makeProject = () => setEditing({ id: createId("project"), name: "", instructions: "", knowledge: [], createdAt: Date.now(), updatedAt: Date.now(), syncState: "local" });
  const saveProject = (project: NaviProject) => { save([project, ...projects.filter((item) => item.id !== project.id)]); setEditing(null); };

  return <>
    <div className="workspace-actions">
      <SearchField value={query} onChange={setQuery} placeholder="Search projects" />
      <div className="workspace-toolbar">
        <label className="workspace-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">Last updated</option><option value="created">Recently created</option><option value="name">Name</option></select></label>
        <button type="button" className="workspace-primary workspace-small-primary" onClick={makeProject}><Plus size={16} />New project</button>
      </div>
    </div>
    {ordered.length ? <div className="workspace-list">{ordered.map((project) => <article className="workspace-row workspace-card" key={project.id}><span className="workspace-row-icon"><FolderKanban size={18} /></span><button type="button" className="workspace-project-button" onClick={() => setEditing(project)}><span className="workspace-row-copy"><strong>{project.name}</strong><small>{project.instructions || "No project instructions yet"}</small><em>{project.knowledge.length} knowledge item{project.knowledge.length === 1 ? "" : "s"} · {chats.filter((chat) => chat.projectId === project.id).length} chat{chats.filter((chat) => chat.projectId === project.id).length === 1 ? "" : "s"}</em></span></button><button type="button" className="workspace-icon-button" onClick={() => setEditing(project)} aria-label={`Edit ${project.name}`}><Settings2 size={16} /></button><button type="button" className="workspace-icon-button danger" onClick={() => save(projects.filter((item) => item.id !== project.id))} aria-label={`Delete ${project.name}`}><Trash2 size={16} /></button></article>)}</div> : <Empty title={query ? "No matching projects" : "Create your first project"} body={query ? "Try a different search, or create a new project." : "Projects keep instructions, decisions, and knowledge available across your related chats."} action="New project" onAction={makeProject} icon={FolderKanban} />}
    {editing ? <ProjectEditor project={editing} existing={projects.some((project) => project.id === editing.id)} onClose={() => setEditing(null)} onSave={saveProject} /> : null}
  </>;
}

function ArtifactList({ chats }: { chats: StoredChat[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => artifacts(chats).filter((artifact) => `${artifact.title} ${artifact.kind} ${artifact.chat.title}`.toLowerCase().includes(query.toLowerCase())), [chats, query]);
  return <><div className="workspace-actions"><SearchField value={query} onChange={setQuery} placeholder="Search artifacts" /><div className="workspace-toolbar workspace-toolbar-end"><Link href="/new?artifact=1" className="workspace-primary workspace-small-primary"><Plus size={16} />New artifact</Link></div></div>{results.length ? <div className="workspace-list">{results.map((artifact) => <Link className="workspace-row" href={`/chat/${encodeURIComponent(artifact.chat.id)}`} key={`${artifact.chat.id}-${artifact.id}`}><span className="workspace-row-icon"><FileText size={18} /></span><span className="workspace-row-copy"><strong>{artifact.title}</strong><small>{artifact.kind} · Source: {artifact.chat.title}</small></span><ArrowRight size={16} /></Link>)}</div> : <Empty title={query ? "No matching artifacts" : "Build something useful"} body={query ? "Try a different search, or build a new artifact in a chat." : "Ask Navi to create an artifact in a chat. Valid saved artifacts will show up here."} action="New artifact" href="/new?artifact=1" icon={WandSparkles} />}</>;
}

function Connectors({ preferences, save }: { preferences: NaviPreferences; save: (preferences: NaviPreferences) => void }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => { void fetch("/api/mcp/connect").then((response) => response.ok ? response.json() : { servers: [] }).then((data: { servers?: Server[] }) => setServers(data.servers || [])).catch(() => setServers([])); }, []);
  const toggle = async (server: Server) => {
    const connected = preferences.connectedMcpServers.includes(server.id);
    if (connected) { save({ ...preferences, connectedMcpServers: preferences.connectedMcpServers.filter((id) => id !== server.id) }); return; }
    setNote(`Checking ${server.name}…`);
    try {
      const response = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: server.id }) });
      const data = await response.json() as { connected?: boolean; error?: string };
      if (!response.ok || !data.connected) throw new Error(data.error || "Could not connect.");
      save({ ...preferences, connectedMcpServers: [...preferences.connectedMcpServers, server.id] });
      setNote(`${server.name} connected.`);
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not connect."); }
  };
  return <><p className="workspace-note">{note || "Navi checks each configured server before it can be used. Catalog entries below are not connected yet."}</p><div className="workspace-list">{servers.map((server) => { const active = preferences.connectedMcpServers.includes(server.id); return <div className="workspace-row workspace-card" key={server.id}><span className="workspace-row-icon"><Cable size={18} /></span><span className="workspace-row-copy"><strong>{server.name}</strong><small>{server.url}</small></span><button type="button" className={active ? "workspace-toggle on" : "workspace-toggle"} onClick={() => void toggle(server)} aria-pressed={active}>{active ? "Disconnect" : "Connect"}</button></div>; })}{!servers.length ? <div className="workspace-empty compact"><Cable size={22} /><h2>No configured connectors</h2><p>Add a server configuration to make a connector available here.</p></div> : null}{officialConnectors.map((name) => <div className="workspace-row workspace-card" key={name}><span className="workspace-row-icon"><Cable size={18} /></span><span className="workspace-row-copy"><strong>{name}</strong><small>Catalog entry · not configured</small></span><span className="workspace-status">Unavailable</span></div>)}</div></>;
}

function GeneralControls({ preferences, save }: { preferences: NaviPreferences; save: (preferences: NaviPreferences) => void }) {
  return <div className="workspace-list"><label className="workspace-control">Response style<select value={preferences.style} onChange={(event) => save({ ...preferences, style: event.target.value as NaviPreferences["style"] })}>{RESPONSE_STYLES.map((style) => <option value={style.id} key={style.id}>{style.label}</option>)}</select></label><label className="workspace-control">Model route<select value={preferences.preset} onChange={(event) => save({ ...preferences, preset: event.target.value as NaviPreferences["preset"] })}>{MODEL_PRESETS.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label><label className="workspace-control">Theme<select value={preferences.theme} onChange={(event) => save({ ...preferences, theme: event.target.value as NaviPreferences["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="workspace-control">Motion<select value={preferences.motion} onChange={(event) => save({ ...preferences, motion: event.target.value as NaviPreferences["motion"] })}><option value="full">Full</option><option value="reduced">Reduced</option></select></label><label className="workspace-switch"><span><strong>Haptics</strong><small>Feedback for supported interactions on this device</small></span><input type="checkbox" checked={preferences.haptics} onChange={() => save({ ...preferences, haptics: !preferences.haptics })} /></label></div>;
}

function CapabilityControls({ preferences, save }: { preferences: NaviPreferences; save: (preferences: NaviPreferences) => void }) {
  const label: Record<keyof NaviPreferences["tools"], [string, string]> = { web: ["Web research", "Only available when your selected route supports it"], code: ["Code tools", "Only available in routes that expose code execution"], artifacts: ["Artifacts", "Save structured Navi artifacts from compatible responses"] };
  return <div className="workspace-list">{(Object.keys(preferences.tools) as Array<keyof NaviPreferences["tools"]>).map((tool) => <label className="workspace-switch" key={tool}><span><strong>{label[tool][0]}</strong><small>{label[tool][1]}</small></span><input type="checkbox" checked={preferences.tools[tool]} onChange={() => save({ ...preferences, tools: { ...preferences.tools, [tool]: !preferences.tools[tool] } })} /></label>)}</div>;
}

function SettingsTabs({ view, preferences, save, clear, projectCount, chatCount }: { view: WorkspaceView; preferences: NaviPreferences; save: (preferences: NaviPreferences) => void; clear: () => void; projectCount: number; chatCount: number }) {
  const [tab, setTab] = useState<SettingsTab>("General");
  const supported = preferences.connectedMcpServers.length;
  const tabContent: Record<SettingsTab, ReactNode> = {
    General: <GeneralControls preferences={preferences} save={save} />,
    Account: <div className="workspace-list"><div className="workspace-info-card"><CircleUserRound size={20} /><div><strong>Account connection</strong><p>Sign-in is not configured for this deployment, so this workspace remains local to this browser.</p></div></div></div>,
    Privacy: <div className="workspace-list"><label className="workspace-switch"><span><strong>Save history</strong><small>Keep chats, projects, and preferences in this browser</small></span><input type="checkbox" checked={preferences.saveHistory} onChange={() => save({ ...preferences, saveHistory: !preferences.saveHistory })} /></label><div className="workspace-info-card"><LockKeyhole size={20} /><div><strong>Local-first storage</strong><p>Workspace data is stored on this device. Connected server access is only used after you explicitly connect a configured server.</p></div></div><button type="button" className="workspace-danger" onClick={clear}>Clear this device&apos;s local workspace data</button></div>,
    Capabilities: <CapabilityControls preferences={preferences} save={save} />,
    Reflect: <Unavailable icon={Brain} title="Reflection is not enabled" body="Navi does not currently keep a separate reflection log or infer preferences from your chats." />,
    "Time and focus": <Unavailable icon={Clock3} title="No focus data is being tracked" body="Navi does not schedule time, read your calendar, or monitor focus without a configured connector and a future integration." />,
    Skills: <Unavailable icon={WandSparkles} title="No installed skills" body="Navi has no separately installed skill packages in this workspace. Your selected model route and tool controls are shown under General and Capabilities." />,
    Connectors: <div className="workspace-list"><div className="workspace-info-card"><Cable size={20} /><div><strong>{supported} connected server{supported === 1 ? "" : "s"}</strong><p>Only configured servers can be connected. Review or change them in the Connectors workspace.</p></div></div><Link className="workspace-primary workspace-inline-link" href="/connectors">Open connectors</Link></div>,
    Plugins: <Unavailable icon={Puzzle} title="No plugins installed" body="This deployment does not claim third-party plugins that are not configured and verified." />,
    Memory: <div className="workspace-list"><div className="workspace-info-card"><ShieldCheck size={20} /><div><strong>Local workspace memory</strong><p>{chatCount} saved chat{chatCount === 1 ? "" : "s"} and {projectCount} project{projectCount === 1 ? "" : "s"} are stored on this device. Project instructions and knowledge are used only when you select that project.</p></div></div><button type="button" className="workspace-danger" onClick={clear}>Clear local memory from this device</button></div>,
  };

  return <section className="workspace-settings"><div className="workspace-tabs" role="tablist" aria-label={view === "customize" ? "Customize sections" : "Settings sections"}>{settingsTabs.map((item) => <button type="button" key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : undefined} onClick={() => setTab(item)}>{item}</button>)}</div><div className="workspace-tab-panel" role="tabpanel">{tabContent[tab]}</div></section>;
}

function Unavailable({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return <div className="workspace-empty compact"><Icon size={23} /><h2>{title}</h2><p>{body}</p></div>;
}

export function WorkspaceLibrary({ view }: { view: WorkspaceView }) {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [projects, setProjects] = useState<NaviProject[]>([]);
  const [preferences, setPreferences] = useState<NaviPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const persistProjects = (next: NaviProject[]) => { setProjects(next); void setLocalValue("projects", next); };
  const persistPreferences = (next: NaviPreferences) => { setPreferences(next); void setLocalValue("preferences", next); };
  const clear = () => {
    if (!window.confirm("Clear all local Navi chats, projects, preferences, and drafts on this device?")) return;
    void clearLocalState().then(() => { setChats([]); setProjects([]); setPreferences(DEFAULT_PREFERENCES); });
  };
  useEffect(() => { void loadLocalState().then((state) => { setChats(state.chats); setProjects(state.projects); setPreferences(state.preferences); }).finally(() => setLoaded(true)); }, []);
  useEffect(() => {
    const apply = () => { const theme = resolvedTheme(preferences.theme); document.documentElement.dataset.theme = theme; document.documentElement.dataset.motion = preferences.motion; document.documentElement.classList.toggle("dark", theme === "dark"); localStorage.setItem("navi.theme.v3", theme); };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.motion, preferences.theme]);
  const [eyebrow, title, description] = copy[view];
  const content = !loaded ? <div className="workspace-loading">Loading your workspace…</div> : view === "recents" ? <ChatList chats={chats} /> : view === "projects" ? <ProjectList projects={projects} chats={chats} save={persistProjects} /> : view === "artifacts" ? <ArtifactList chats={chats} /> : view === "connectors" ? <Connectors preferences={preferences} save={persistPreferences} /> : <SettingsTabs view={view} preferences={preferences} save={persistPreferences} clear={clear} projectCount={projects.length} chatCount={chats.length} />;

  return <main className="workspace-page"><header className="workspace-header"><Link href="/new" className="workspace-mark" aria-label="New chat"><NaviMark className="h-8 w-8" /></Link><div><p>{eyebrow}</p><h1>{title}</h1></div><Link href="/new" className="workspace-new"><Plus size={17} /><span>New chat</span></Link></header><section className="workspace-intro"><p>{description}</p></section>{content}<nav className="workspace-nav" aria-label="Workspace"><Link href="/recents" aria-current={view === "recents" ? "page" : undefined}><BookOpen size={17} />Chats</Link><Link href="/projects" aria-current={view === "projects" ? "page" : undefined}><FolderKanban size={17} />Projects</Link><Link href="/artifacts" aria-current={view === "artifacts" ? "page" : undefined}><Boxes size={17} />Artifacts</Link><Link href="/connectors" aria-current={view === "connectors" ? "page" : undefined}><Cable size={17} />Connectors</Link><Link href="/settings" aria-current={view === "settings" ? "page" : undefined}><UserRound size={17} />Settings</Link></nav></main>;
}
