"use client";

import { Check, ChevronLeft, FileText, FolderKanban, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NaviProject, StoredChat } from "@/lib/ai/types";
import { haptic } from "@/lib/ui/haptics";

type Props = {
  open: boolean;
  projects: NaviProject[];
  activeProjectId: string | null;
  chats: StoredChat[];
  haptics: boolean;
  onClose: () => void;
  onCreate: (project: NaviProject) => void;
  onUpdate: (project: NaviProject) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
};

function createProject(): NaviProject {
  const now = Date.now();
  return {
    id: crypto.randomUUID?.() ?? `project-${now.toString(36)}`,
    name: "New project",
    instructions: "",
    knowledge: [],
    createdAt: now,
    updatedAt: now,
    syncState: "local"
  };
}

export function ProjectsSheet({
  open,
  projects,
  activeProjectId,
  chats,
  haptics,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onSelect
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(activeProjectId);
  const [knowledgeDraft, setKnowledgeDraft] = useState("");

  useEffect(() => {
    if (open) setSelectedId(activeProjectId ?? projects[0]?.id ?? null);
  }, [activeProjectId, open, projects]);

  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const conversationCount = useMemo(
    () => chats.filter((chat) => chat.projectId === selected?.id).length,
    [chats, selected?.id]
  );

  if (!open) return null;

  function patch(project: NaviProject, change: Partial<NaviProject>) {
    onUpdate({ ...project, ...change, updatedAt: Date.now(), syncState: "local" });
  }

  function addProject() {
    const project = createProject();
    onCreate(project);
    setSelectedId(project.id);
    haptic("success", haptics);
  }

  function addKnowledge() {
    if (!selected || !knowledgeDraft.trim()) return;
    patch(selected, { knowledge: [...selected.knowledge, knowledgeDraft.trim()] });
    setKnowledgeDraft("");
    haptic("success", haptics);
  }

  function removeProject(project: NaviProject) {
    if (!window.confirm(`Delete “${project.name}”? Its conversations will remain in history.`)) return;
    onDelete(project.id);
    setSelectedId(projects.find((item) => item.id !== project.id)?.id ?? null);
    haptic("warning", haptics);
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-app text-primary">
      <header className="safe-top flex min-h-[64px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-elev-1 px-3">
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close projects"><X size={21} /></button>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px]/6 font-semibold text-primary">Projects</span>
          <span className="block text-[11px]/4 font-medium text-tertiary">Instructions, knowledge, and conversation continuity</span>
        </span>
        <button type="button" onClick={addProject} className="flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px]/5 font-semibold text-white active:bg-accent-pressed"><Plus size={17} />New</button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
        <aside className={`${selected ? "hidden md:block" : "block"} scroll-area overflow-y-auto border-r border-[var(--border-subtle)] bg-elev-1 p-3`}>
          <button type="button" onClick={() => { onSelect(null); haptic("selection", haptics); }} className={`mb-2 flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-3 ${activeProjectId === null ? "bg-[var(--selection-bg)]" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-elev-2 text-secondary"><FolderKanban size={18} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[14px]/5 font-semibold text-primary">No project</span><span className="block text-[11px]/4 font-medium text-tertiary">Use only this conversation</span></span>
            {activeProjectId === null ? <Check size={17} className="text-accent" /> : null}
          </button>
          {projects.map((project) => {
            const count = chats.filter((chat) => chat.projectId === project.id).length;
            return (
              <button key={project.id} type="button" onClick={() => { setSelectedId(project.id); haptic("selection", haptics); }} className={`mb-1 flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-3 ${selectedId === project.id ? "bg-[var(--selection-bg)]" : ""}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-elev-2 text-accent"><FolderKanban size={19} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px]/5 font-semibold text-primary">{project.name}</span><span className="block text-[11px]/4 font-medium text-tertiary">{count} conversation{count === 1 ? "" : "s"} · {project.knowledge.length} knowledge item{project.knowledge.length === 1 ? "" : "s"}</span></span>
                {activeProjectId === project.id ? <Check size={17} className="text-accent" /> : null}
              </button>
            );
          })}
          {!projects.length ? <div className="px-4 py-12 text-center text-[13px]/5 font-medium text-tertiary">Create a project to keep instructions and knowledge available across conversations.</div> : null}
        </aside>

        <main className={`${selected ? "block" : "hidden md:block"} scroll-area min-h-0 overflow-y-auto bg-app`}>
          {selected ? (
            <div className="mx-auto w-full max-w-[760px] px-4 pb-[calc(24px+var(--safe-bottom))] pt-4">
              <button type="button" onClick={() => setSelectedId(null)} className="mb-3 flex min-h-10 items-center gap-1 text-[13px]/5 font-semibold text-secondary md:hidden"><ChevronLeft size={18} />All projects</button>

              <div className="rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent"><FolderKanban size={23} /></span>
                  <span className="min-w-0 flex-1">
                    <input value={selected.name} onChange={(event) => patch(selected, { name: event.target.value.slice(0, 80) })} className="w-full bg-transparent text-[21px]/7 font-semibold tracking-[-0.02em] text-primary outline-none" aria-label="Project name" />
                    <span className="mt-1 block text-[11px]/4 font-medium text-tertiary">{conversationCount} saved conversation{conversationCount === 1 ? "" : "s"} · Local-first workspace</span>
                  </span>
                  <button type="button" onClick={() => removeProject(selected)} className="flex h-11 w-11 items-center justify-center rounded-full text-danger active:bg-elev-3" aria-label="Delete project"><Trash2 size={18} /></button>
                </div>

                <button type="button" onClick={() => { onSelect(selected.id); haptic("success", haptics); }} className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px]/5 font-semibold ${activeProjectId === selected.id ? "bg-elev-3 text-primary" : "bg-accent text-white active:bg-accent-pressed"}`}>
                  {activeProjectId === selected.id ? <><Check size={17} />Active in this conversation</> : "Use this project"}
                </button>
              </div>

              <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <h2 className="text-[15px]/5 font-semibold text-primary">Project instructions</h2>
                <p className="mt-1 text-[11px]/4 font-medium text-tertiary">Applied to every new request while this project is active.</p>
                <textarea value={selected.instructions} onChange={(event) => patch(selected, { instructions: event.target.value.slice(0, 8_000) })} placeholder="Describe the project, rules, tone, constraints, and definition of done…" className="mt-3 min-h-[150px] w-full resize-y rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[14px]/6 font-medium text-primary outline-none focus:border-accent" />
              </section>

              <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <h2 className="text-[15px]/5 font-semibold text-primary">Project knowledge</h2>
                <p className="mt-1 text-[11px]/4 font-medium text-tertiary">Durable notes supplied to Navi without altering the saved conversations.</p>
                <div className="mt-3 flex gap-2">
                  <textarea value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder="Add a decision, requirement, source note, or project fact…" className="min-h-[92px] min-w-0 flex-1 resize-none rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[13px]/5 font-medium text-primary outline-none focus:border-accent" />
                  <button type="button" onClick={addKnowledge} disabled={!knowledgeDraft.trim()} className="flex w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white active:bg-accent-pressed disabled:opacity-40" aria-label="Add project knowledge"><Plus size={19} /></button>
                </div>
                <div className="mt-3 space-y-2">
                  {selected.knowledge.map((item, index) => (
                    <div key={`${selected.id}-${index}`} className="flex gap-3 rounded-2xl bg-elev-2 p-3">
                      <FileText size={17} className="mt-0.5 shrink-0 text-accent" />
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px]/5 font-medium text-secondary">{item}</p>
                      <button type="button" onClick={() => patch(selected, { knowledge: selected.knowledge.filter((_, itemIndex) => itemIndex !== index) })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elev-3" aria-label="Remove knowledge item"><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {!selected.knowledge.length ? <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-center text-[12px]/5 font-medium text-tertiary">No project knowledge yet.</div> : null}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-[13px]/5 font-medium text-tertiary">Select or create a project.</div>
          )}
        </main>
      </div>
    </div>
  );
}
