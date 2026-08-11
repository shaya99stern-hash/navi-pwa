"use client";

import { Check, ChevronLeft, FileText, FolderKanban, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * A project is created from a name the user typed, never before it.
 *
 * This used to run on the New button with no input at all, producing a project
 * literally called "New project" with empty instructions — which is exactly
 * what the exported data shows: one project, unnamed, no instructions, and no
 * conversation ever filed into it. Naming something after creating it is a
 * step people skip, so the thing that gives a project its whole purpose — the
 * instructions every chat in it inherits — stayed empty.
 *
 * Asking first costs one sheet and makes the feature legible: you are not
 * making a folder, you are stating what this project is for.
 */
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

/**
 * A file as base64, without the data-URL prefix the reader adds.
 *
 * `readAsDataURL` rather than `readAsArrayBuffer` and a manual encode: the
 * browser's own base64 is faster than anything written here, and the prefix is
 * a known fixed shape rather than something to parse.
 */
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

/* Some platforms hand over an empty `type` for files picked from cloud
   storage, and a markdown file is routinely typed as nothing at all. The
   extension is the only signal left, and guessing wrong here costs a clear
   error from the route rather than a bad document. */
function guessMediaType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "xml") return "application/xml";
  return "text/plain";
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
  /** The creation form. Null when it is not open. */
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
    /* Created *and* selected for this conversation. Making a project and then
       having to find a second button to actually use it is the step where the
       feature was being abandoned. */
    onSelect(project.id);
    setDraft(null);
  }

  function addKnowledge() {
    if (!selected || !knowledgeDraft.trim()) return;
    patch(selected, { knowledge: [...selected.knowledge, knowledgeDraft.trim()] });
    setKnowledgeDraft("");
    haptic("success", haptics);
  }

  /**
   * Read files into the project as text.
   *
   * Sequential rather than parallel: extraction is a model-free server call but
   * a PDF is still real work, and four at once on a phone competes with the
   * scroll it is happening under. The failures are per-file and reported per
   * file, because "one of your four documents was a scan" is the only version
   * of that message anyone can act on.
   */
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
      /* Capped at twenty, matching what storage will keep on read. Silently
         storing a twenty-first that disappears on the next load is worse than
         refusing it. */
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
    <div className="fixed inset-0 z-[120] flex flex-col bg-app text-primary">
      <header className="safe-top flex min-h-[64px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-elev-1 px-3">
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-secondary active:bg-elev-3" aria-label="Close projects"><X size={21} /></button>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.0625rem]/6 font-semibold text-primary">Projects</span>
          <span className="block text-[0.6875rem]/4 font-medium text-tertiary">Instructions, knowledge, and conversation continuity</span>
        </span>
        <button type="button" onClick={beginProject} className="flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[0.8125rem]/5 font-semibold text-white active:bg-accent-pressed"><Plus size={17} />New</button>
      </header>

      {/* Name and purpose first. The instructions field is the reason projects
          exist — every chat in the project inherits it — so it is on the
          creation form rather than behind a later edit nobody makes. It is
          optional: refusing to create a project without a paragraph of setup
          would just push people back to plain chats. */}
      {draft ? (
        <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center">
          <button type="button" aria-label="Cancel" onClick={() => setDraft(null)} className="absolute inset-0 bg-overlay backdrop-blur-[3px]" />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="New project"
            className="navi-sheet relative w-full max-w-[520px] px-gutter pb-[calc(20px+var(--safe-bottom))] pt-4 sm:rounded-[24px] sm:pb-5"
          >
            <h2 className="text-[1.0625rem]/6 font-semibold text-primary">New project</h2>
            <p className="mt-1 text-[0.75rem]/4 font-medium text-tertiary">
              Every conversation in this project follows its instructions.
            </p>

            <label className="mt-4 block text-[0.75rem]/4 font-semibold text-secondary" htmlFor="navi-project-name">Name</label>
            <input
              id="navi-project-name"
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 80) })}
              onKeyDown={(event) => { if (event.key === "Enter" && draft.name.trim()) commitProject(); }}
              placeholder="Client work, Thesis, NaviOS…"
              className="mt-1.5 min-h-12 w-full rounded-[14px] bg-elev-2 px-3.5 text-[1rem]/6 text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
            />

            <label className="mt-4 block text-[0.75rem]/4 font-semibold text-secondary" htmlFor="navi-project-instructions">Instructions</label>
            <textarea
              id="navi-project-instructions"
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value.slice(0, 8_000) })}
              rows={4}
              placeholder="What this project is, how you want it approached, anything that should be true of every answer…"
              className="mt-1.5 min-h-[112px] w-full resize-y rounded-[14px] bg-elev-2 px-3.5 py-3 text-[0.9375rem]/[1.375rem] text-primary outline-none placeholder:text-tertiary focus:bg-elev-3"
            />
            <p className="mt-1.5 text-[0.6875rem]/4 font-medium text-tertiary">Optional, and editable later.</p>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="min-h-12 flex-1 rounded-full bg-elev-2 text-[0.875rem]/5 font-semibold text-primary active:bg-elev-3">
                Cancel
              </button>
              <button
                type="button"
                onClick={commitProject}
                disabled={!draft.name.trim()}
                className="min-h-12 flex-1 rounded-full bg-accent text-[0.875rem]/5 font-semibold text-[var(--accent-on-primary)] active:bg-accent-pressed disabled:opacity-50"
              >
                Create project
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
        <aside className={`${selected ? "hidden md:block" : "block"} scroll-area overflow-y-auto border-r border-[var(--border-subtle)] bg-elev-1 p-3`}>
          <button type="button" onClick={() => { onSelect(null); haptic("selection", haptics); }} className={`mb-2 flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-3 ${activeProjectId === null ? "bg-[var(--selection-bg)]" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-elev-2 text-secondary"><FolderKanban size={18} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[0.875rem]/5 font-semibold text-primary">No project</span><span className="block text-[0.6875rem]/4 font-medium text-tertiary">Use only this conversation</span></span>
            {activeProjectId === null ? <Check size={17} className="text-accent" /> : null}
          </button>
          {projects.map((project) => {
            const count = chats.filter((chat) => chat.projectId === project.id).length;
            return (
              <button key={project.id} type="button" onClick={() => { setSelectedId(project.id); haptic("selection", haptics); }} className={`mb-1 flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-elev-3 ${selectedId === project.id ? "bg-[var(--selection-bg)]" : ""}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-elev-2 text-accent"><FolderKanban size={19} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[0.875rem]/5 font-semibold text-primary">{project.name}</span><span className="block text-[0.6875rem]/4 font-medium text-tertiary">{count} conversation{count === 1 ? "" : "s"} · {project.knowledge.length} knowledge item{project.knowledge.length === 1 ? "" : "s"}</span></span>
                {activeProjectId === project.id ? <Check size={17} className="text-accent" /> : null}
              </button>
            );
          })}
          {!projects.length ? <div className="px-4 py-12 text-center text-[0.8125rem]/5 font-medium text-tertiary">Create a project to keep instructions and knowledge available across conversations.</div> : null}
        </aside>

        <main className={`${selected ? "block" : "hidden md:block"} scroll-area min-h-0 overflow-y-auto bg-app`}>
          {selected ? (
            <div className="mx-auto w-full max-w-[760px] px-4 pb-[calc(24px+var(--safe-bottom))] pt-4">
              <button type="button" onClick={() => setSelectedId(null)} className="mb-3 flex min-h-10 items-center gap-1 text-[0.8125rem]/5 font-semibold text-secondary md:hidden"><ChevronLeft size={18} />All projects</button>

              <div className="rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-bg)] text-accent"><FolderKanban size={23} /></span>
                  <span className="min-w-0 flex-1">
                    <input value={selected.name} onChange={(event) => patch(selected, { name: event.target.value.slice(0, 80) })} className="w-full bg-transparent text-[1.3125rem]/7 font-semibold tracking-[-0.02em] text-primary outline-none" aria-label="Project name" />
                    <span className="mt-1 block text-[0.6875rem]/4 font-medium text-tertiary">{conversationCount} saved conversation{conversationCount === 1 ? "" : "s"} · Local-first workspace</span>
                  </span>
                  <button type="button" onClick={() => removeProject(selected)} className="flex h-11 w-11 items-center justify-center rounded-full text-danger active:bg-elev-3" aria-label="Delete project"><Trash2 size={18} /></button>
                </div>

                <button type="button" onClick={() => { onSelect(selected.id); haptic("success", haptics); }} className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[0.875rem]/5 font-semibold ${activeProjectId === selected.id ? "bg-elev-3 text-primary" : "bg-accent text-white active:bg-accent-pressed"}`}>
                  {activeProjectId === selected.id ? <><Check size={17} />Active in this conversation</> : "Use this project"}
                </button>
              </div>

              <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Project instructions</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Applied to every new request while this project is active.</p>
                <textarea value={selected.instructions} onChange={(event) => patch(selected, { instructions: event.target.value.slice(0, 8_000) })} placeholder="Describe the project, rules, tone, constraints, and definition of done…" className="mt-3 min-h-[150px] w-full resize-y rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[0.875rem]/6 font-medium text-primary outline-none focus:border-accent" />
              </section>

              <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Project knowledge</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Durable notes supplied to Navi Soul without altering the saved conversations.</p>
                <div className="mt-3 flex gap-2">
                  <textarea value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder="Add a decision, requirement, source note, or project fact…" className="min-h-[92px] min-w-0 flex-1 resize-none rounded-2xl border border-[var(--border-subtle)] bg-elev-2 p-3 text-[0.8125rem]/5 font-medium text-primary outline-none focus:border-accent" />
                  <button type="button" onClick={addKnowledge} disabled={!knowledgeDraft.trim()} className="flex w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white active:bg-accent-pressed disabled:opacity-40" aria-label="Add project knowledge"><Plus size={19} /></button>
                </div>
                <div className="mt-3 space-y-2">
                  {selected.knowledge.map((item, index) => (
                    <div key={`${selected.id}-${index}`} className="flex gap-3 rounded-2xl bg-elev-2 p-3">
                      <FileText size={17} className="mt-0.5 shrink-0 text-accent" />
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[0.8125rem]/5 font-medium text-secondary">{item}</p>
                      <button type="button" onClick={() => patch(selected, { knowledge: selected.knowledge.filter((_, itemIndex) => itemIndex !== index) })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elev-3" aria-label="Remove knowledge item"><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {!selected.knowledge.length ? <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-center text-[0.75rem]/5 font-medium text-tertiary">No project knowledge yet.</div> : null}
                </div>
              </section>

              {/* Files, which is what makes this a knowledge base rather than a
                  system prompt with a name. The document's *text* is what gets
                  stored and carried — see the extraction route for why. */}
              <section className="mt-4 rounded-[24px] border border-[var(--border-subtle)] bg-elev-1 p-4">
                <h2 className="text-[0.9375rem]/5 font-semibold text-primary">Project files</h2>
                <p className="mt-1 text-[0.6875rem]/4 font-medium text-tertiary">Attach documents once and Navi Soul reads them in every conversation in this project. PDF, CSV, JSON, and text.</p>
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
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-elev-2 px-4 text-[0.8125rem]/5 font-semibold text-primary active:bg-elev-3 disabled:opacity-50"
                >
                  <Upload size={16} />{uploading ? "Reading…" : "Add files"}
                </button>
                {uploadError ? <p className="mt-2 text-[0.75rem]/5 font-medium text-danger">{uploadError}</p> : null}
                <div className="mt-3 space-y-2">
                  {(selected.documents ?? []).map((document) => (
                    <div key={document.id} className="flex gap-3 rounded-2xl bg-elev-2 p-3">
                      <FileText size={17} className="mt-0.5 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem]/5 font-semibold text-primary">{document.name}</span>
                        {/* The character count is the honest unit here: it is
                            what the budget is spent in, and "truncated" without
                            a size reads as a failure rather than a limit. */}
                        <span className="block text-[0.6875rem]/4 font-medium text-tertiary">
                          {document.text.length.toLocaleString()} characters{document.truncated ? " · truncated to fit" : ""}
                        </span>
                      </span>
                      <button type="button" onClick={() => patch(selected, { documents: (selected.documents ?? []).filter((entry) => entry.id !== document.id) })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elev-3" aria-label={`Remove ${document.name}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {!(selected.documents ?? []).length ? <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-center text-[0.75rem]/5 font-medium text-tertiary">No files yet.</div> : null}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-[0.8125rem]/5 font-medium text-tertiary">Select or create a project.</div>
          )}
        </main>
      </div>
    </div>
  );
}
