"use client";

import { Check, ChevronLeft, FileText, FolderKanban, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NaviProject, ProjectDocument, StoredChat } from "@/lib/ai/types";
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

function createProject(name: string, instructions: string): NaviProject {
  const now = Date.now();
  return {
    id: crypto.randomUUID?.() ?? `project-${now.toString(36)}`,
    name: name.trim().slice(0, 80),
    instructions: instructions.trim().slice(0, 8_000),
    knowledge: [],
    createdAt: now,
    updatedAt: now,
    syncState: "local"
  };
}

function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      comma === -1 ? reject(new Error("Unreadable file.")) : resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unreadable file."));
    reader.readAsDataURL(file);
  });
}

function guessMediaType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "xml") return "application/xml";
  return "text/plain";
}

// iOS Native UI Helpers
function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-6 px-4 text-[0.8125rem] font-medium text-tertiary uppercase tracking-wide">{children}</h3>;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-6 overflow-hidden rounded-[10px] bg-elev-2 shadow-sm">{children}</div>;
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ name: string; instructions: string } | null>(null);

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

  function beginProject() {
    haptic("selection", haptics);
    setDraft({ name: "", instructions: "" });
  }

  function commitProject() {
    if (!draft?.name.trim()) return;
    const project = createProject(draft.name, draft.instructions);
    onCreate(project);
    setSelectedId(project.id);
    onSelect(project.id);
    setDraft(null);
  }

  function addKnowledge() {
    if (!selected || !knowledgeDraft.trim()) return;
    patch(selected, { knowledge: [...selected.knowledge, knowledgeDraft.trim()] });
    setKnowledgeDraft("");
    haptic("success", haptics);
  }

  async function addFiles(project: NaviProject, list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setUploading(true);
    setUploadError(null);

    const added: ProjectDocument[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const data = await encodeFile(file);
        const response = await fetch("/api/projects/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, mediaType: file.type || guessMediaType(file.name), data })
        });
        const payload = await response.json() as { title?: string; text?: string; truncated?: boolean; error?: string };
        if (!response.ok || !payload.text) { failed.push(`${file.name}: ${payload.error ?? "could not be read"}`); continue; }
        added.push({
          id: crypto.randomUUID?.() ?? `document-${Date.now().toString(36)}-${added.length}`,
          name: payload.title ?? file.name,
          text: payload.text,
          truncated: Boolean(payload.truncated),
          addedAt: Date.now()
        });
      } catch {
        failed.push(`${file.name}: could not be read`);
      }
    }

    if (added.length) {
      patch(project, { documents: [...(project.documents ?? []), ...added].slice(0, 20) });
      haptic("success", haptics);
    }
    setUploadError(failed.length ? failed.join(" · ") : null);
    setUploading(false);
  }

  function removeProject(project: NaviProject) {
    if (!window.confirm(`Delete “${project.name}”? Its conversations will remain in history.`)) return;
    onDelete(project.id);
    setSelectedId(projects.find((item) => item.id !== project.id)?.id ?? null);
    haptic("warning", haptics);
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#F2F2F7] dark:bg-black text-primary">
      <header className="navi-sheet-header sticky top-0 z-10 flex h-[calc(52px+var(--safe-top))] shrink-0 items-center gap-1 bg-[#F2F2F7] dark:bg-black px-2 pt-[var(--safe-top)] border-b border-[var(--border-subtle)]">
        {selected && (
           <button type="button" onClick={() => setSelectedId(null)} aria-label="Back to Projects" className="flex h-11 w-14 items-center justify-center rounded-full text-accent active:opacity-60 md:hidden">
             <ChevronLeft size={30} strokeWidth={1.5} className="-ml-1" />
           </button>
        )}
        {!selected && <div className="flex h-11 w-14 items-center justify-center md:hidden" aria-hidden="true" />}
        <div className="flex-1 text-center text-[1.0625rem]/6 font-semibold tracking-[-0.01em] text-primary md:pl-4 md:text-left">
          Projects
        </div>
        <button type="button" onClick={onClose} aria-label="Close projects" className="flex h-11 w-[72px] items-center justify-end pr-3 rounded-full text-accent font-semibold text-[1.0625rem] active:opacity-60">
          Done
        </button>
      </header>

      {draft ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center">
          <button type="button" aria-label="Cancel" onClick={() => setDraft(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-label="New project" className="relative w-[90%] max-w-[400px] rounded-[14px] bg-elev-2 p-5 shadow-xl">
            <h2 className="text-[1.0625rem] font-semibold text-center text-primary">New Project</h2>
            <p className="mt-1 text-[0.8125rem] text-center text-tertiary">Every conversation in this project follows its instructions.</p>
            
            <div className="mt-4 space-y-3">
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 80) })}
                onKeyDown={(event) => { if (event.key === "Enter" && draft.name.trim()) commitProject(); }}
                placeholder="Name (e.g. NaviOS, Thesis)"
                className="h-11 w-full rounded-[8px] bg-elev-3 px-3 text-[0.9375rem] text-primary outline-none border border-[var(--border-subtle)] focus:border-accent"
              />
              <textarea
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value.slice(0, 8_000) })}
                rows={3}
                placeholder="Instructions (optional)"
                className="w-full resize-none rounded-[8px] bg-elev-3 p-3 text-[0.9375rem] text-primary outline-none border border-[var(--border-subtle)] focus:border-accent"
              />
            </div>

            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setDraft(null)} className="h-11 flex-1 rounded-[8px] bg-elev-3 text-[0.9375rem] font-medium text-primary active:bg-elev-4">
                Cancel
              </button>
              <button
                type="button"
                onClick={commitProject}
                disabled={!draft.name.trim()}
                className="h-11 flex-1 rounded-[8px] bg-accent text-[0.9375rem] font-medium text-white disabled:opacity-50 active:opacity-80"
              >
                Create
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 md:mx-auto md:w-full md:max-w-[1000px]">
        <aside className={`${selected ? "hidden md:block" : "block"} min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] md:w-[320px] md:border-r md:border-[var(--border-subtle)]`}>
          <div className="mt-2 mb-2 px-4 md:hidden">
             <h2 className="text-[2rem]/8 font-bold text-primary">Projects</h2>
          </div>

          <SectionHeader>Workspace</SectionHeader>
          <Group>
            <button type="button" onClick={() => { onSelect(null); haptic("selection", haptics); }} className="flex min-h-[44px] w-full items-center justify-between border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-2.5 text-left active:bg-elev-3">
              <div className="flex items-center gap-3">
                <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-[#8E8E93] text-white shrink-0"><FolderKanban size={16} strokeWidth={2.5}/></span>
                <span className="text-[1rem] text-primary font-medium">No project</span>
              </div>
              {activeProjectId === null && <Check size={20} className="text-accent shrink-0" />}
            </button>
          </Group>

          <SectionHeader>Your Projects</SectionHeader>
          <Group>
            {projects.map((project) => {
              const count = chats.filter((chat) => chat.projectId === project.id).length;
              return (
                <button key={project.id} type="button" onClick={() => { setSelectedId(project.id); haptic("selection", haptics); }} className="flex min-h-[44px] w-full items-center justify-between border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent px-4 py-2.5 text-left active:bg-elev-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                    <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-accent text-white shrink-0"><FolderKanban size={16} strokeWidth={2.5}/></span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate text-[1rem] font-medium text-primary">{project.name}</span>
                      <span className="text-[0.75rem] text-tertiary mt-0.5">{count} chat{count === 1 ? "" : "s"} · {project.knowledge.length + (project.documents?.length || 0)} item{project.knowledge.length + (project.documents?.length || 0) === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {activeProjectId === project.id && <Check size={20} className="text-accent shrink-0" />}
                </button>
              );
            })}
            {!projects.length ? <div className="px-4 py-8 text-center text-[0.8125rem] text-tertiary">No projects created yet.</div> : null}
          </Group>

          <div className="px-4 mt-6">
            <button type="button" onClick={beginProject} className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-accent/10 text-accent font-semibold text-[0.9375rem] active:bg-accent/20">
              <Plus size={18} strokeWidth={2.5} /> New Project
            </button>
          </div>
        </aside>

        <main className={`${selected ? "block" : "hidden md:block"} min-h-0 w-full flex-1 overflow-y-auto overscroll-contain pb-[calc(24px+var(--safe-bottom))] pt-2`}>
          {selected ? (
            <div className="mx-auto w-full max-w-[760px]">
              
              <SectionHeader>Project Identity</SectionHeader>
              <Group>
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-transparent">
                  <input value={selected.name} onChange={(event) => patch(selected, { name: event.target.value.slice(0, 80) })} className="w-full bg-transparent text-[1.125rem] font-semibold tracking-[-0.02em] text-primary outline-none" aria-label="Project name" />
                </div>
                <button type="button" onClick={() => { onSelect(selected.id); haptic("success", haptics); }} className="flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left active:bg-elev-3 transition-colors">
                  <span className="text-[1rem] font-medium text-primary">Use this project</span>
                  {activeProjectId === selected.id && <Check size={20} className="text-accent" />}
                </button>
              </Group>

              <SectionHeader>Instructions</SectionHeader>
              <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Applied to every new request while this project is active.</p>
              <Group>
                <textarea
                  value={selected.instructions}
                  onChange={(event) => patch(selected, { instructions: event.target.value.slice(0, 8_000) })}
                  placeholder="Describe the project, rules, tone, constraints, and definition of done…"
                  className="min-h-[140px] w-full resize-y bg-transparent p-4 text-[0.9375rem]/6 text-primary outline-none placeholder:text-tertiary"
                />
              </Group>

              <SectionHeader>Knowledge Base</SectionHeader>
              <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Durable notes supplied to Navi Soul automatically.</p>
              <Group>
                <div className="flex gap-3 p-3 border-b border-[var(--border-subtle)] bg-transparent">
                  <textarea
                    value={knowledgeDraft}
                    onChange={(event) => setKnowledgeDraft(event.target.value)}
                    placeholder="Add a decision, requirement, source note, or project fact…"
                    className="min-h-[60px] min-w-0 flex-1 resize-none rounded-[8px] bg-elev-3 p-2.5 text-[0.875rem] text-primary outline-none placeholder:text-tertiary focus:border-accent"
                  />
                  <button type="button" onClick={addKnowledge} disabled={!knowledgeDraft.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-accent text-white active:opacity-80 disabled:opacity-40" aria-label="Add project knowledge"><Plus size={20} /></button>
                </div>
                {selected.knowledge.map((item, index) => (
                  <div key={`${selected.id}-${index}`} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent">
                    <FileText size={18} className="shrink-0 text-tertiary" />
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-[0.875rem]/5 text-primary">{item}</p>
                    <button type="button" onClick={() => patch(selected, { knowledge: selected.knowledge.filter((_, itemIndex) => itemIndex !== index) })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-danger active:bg-elev-3" aria-label="Remove knowledge item"><Trash2 size={16} /></button>
                  </div>
                ))}
                {!selected.knowledge.length ? <div className="px-4 py-6 text-center text-[0.8125rem] text-tertiary">No project knowledge yet.</div> : null}
              </Group>

              <SectionHeader>Project Files</SectionHeader>
              <p className="px-4 mb-2 mt-[-2px] text-[0.8125rem] text-tertiary">Navi Soul reads attached documents in every conversation.</p>
              <Group>
                <div className="p-3 border-b border-[var(--border-subtle)]">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.json,.txt,.md,.xml,application/pdf,text/csv,application/json,text/plain,text/markdown"
                    multiple
                    className="hidden"
                    onChange={(event) => { void addFiles(selected, event.target.files); event.target.value = ""; }}
                  />
                  <button
                    type="button"
                    onClick={() => { haptic("selection", haptics); fileInputRef.current?.click(); }}
                    disabled={uploading}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-elev-3 text-[0.875rem] font-medium text-accent active:bg-elev-4 disabled:opacity-50"
                  >
                    <Upload size={16} />{uploading ? "Reading…" : "Add files"}
                  </button>
                  {uploadError ? <p className="mt-2 text-[0.75rem] text-center text-danger">{uploadError}</p> : null}
                </div>
                {(selected.documents ?? []).map((document) => (
                  <div key={document.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent">
                    <FileText size={18} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] font-medium text-primary">{document.name}</span>
                      <span className="block text-[0.75rem] text-tertiary mt-0.5">
                        {document.text.length.toLocaleString()} characters{document.truncated ? " · truncated to fit" : ""}
                      </span>
                    </span>
                    <button type="button" onClick={() => patch(selected, { documents: (selected.documents ?? []).filter((entry) => entry.id !== document.id) })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-danger active:bg-elev-3" aria-label={`Remove ${document.name}`}><Trash2 size={16} /></button>
                  </div>
                ))}
                {!(selected.documents ?? []).length ? <div className="px-4 py-6 text-center text-[0.8125rem] text-tertiary">No files yet.</div> : null}
              </Group>

              <div className="mt-8 px-4">
                 <button onClick={() => removeProject(selected)} className="flex items-center justify-center gap-2 w-full h-[50px] rounded-[10px] bg-elev-2 text-danger font-normal text-[1.0625rem] active:bg-elev-3 shadow-sm">
                   Delete Project
                 </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-[0.875rem] text-tertiary">Select or create a project.</div>
          )}
        </main>
      </div>
    </div>
  );
}
