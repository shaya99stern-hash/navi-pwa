import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const sheet = read("app/components/projects-sheet.tsx").body;
const drawer = read("app/components/history-drawer.tsx").body;
const shell = read("app/components/app-shell.tsx").body;

/* ---- A project is named before it exists ------------------------------- */

/* The New button used to create a project outright, with no input: name "New
   project", instructions empty. The exported data is the proof it did not
   work — one project, that exact name, no instructions, and not one
   conversation ever filed into it. Naming a thing after making it is a step
   people skip, so the field that gives a project its entire purpose stayed
   blank. */
check("creating takes a name", /function createProject\(name: string, instructions: string\)/.test(sheet), true);
check("the placeholder name is gone", sheet.includes('name: "New project"'), false);
check("the button opens a form rather than creating", /onClick=\{beginProject\}/.test(sheet), true);
/* The field is what matters, not how it is labelled. The redesign dropped the
   label id in favour of a placeholder, which carries the same information to a
   sighted reader — so this asserts the control is bound to the draft rather
   than pinning the markup that presents it. */
check("the form collects instructions too", /value=\{draft\.instructions\}/.test(sheet), true);
/* A project with no name is the bug this fixes; a project with no
   instructions is a legitimate choice. Only the name is required. */
check("a nameless project cannot be created", /disabled=\{!draft\.name\.trim\(\)\}/.test(sheet), true);
check("instructions are optional", /placeholder="Instructions \(optional\)"/.test(sheet), true);
/* Created and selected in one act. Having to find a second button to actually
   use the project is where the flow was being abandoned. */
check("creating also selects it for this conversation", /onCreate\(project\)[\s\S]{0,400}onSelect\(project\.id\)/.test(sheet), true);

/* ---- Projects are visible in the sidebar ------------------------------- */

/* They lived only behind a sheet, so a project was something you made once and
   never saw again. A project you cannot see is one you never file into.

   The drawer now names them once, with a count, and the Projects screen holds
   the list: a second list inside the panel competed with the conversations for
   the same scroll area, and pushed the matches off screen during a search. */
check("the drawer takes projects", /projects: NaviProject\[\]/.test(drawer), true);
check("the drawer names them", /Projects\n/.test(drawer), true);
check("the row carries the count", /projects\.length \? <span/.test(drawer), true);
check("no second list competes for the scroll area", /projects\.slice\(0, 6\)\.map/.test(drawer), false);
check("there is still a way to all projects", /openSheet\(onProjects\)/.test(drawer), true);

/* ---- Opening one is a single act -------------------------------------- */

check("the shell passes projects to the drawer", /projects=\{projects\}/.test(shell), true);
/* Selecting one is the Projects screen's own job — it already carries the
   active mark, the check and the "no project" row. */
check("the projects sheet selects", /onSelect=\{/.test(shell), true);

/* ---- What was already right, and must stay so -------------------------- */

/* Two claims in the round-2 audit were wrong, and these pin the behaviour so
   the corrections do not drift back: project knowledge does reach the model,
   and filing a chat into a project already exists. */
check("project knowledge is sent with the request", /knowledge: activeProject\.knowledge/.test(shell), true);
check("the server summarises project knowledge", read("app/api/chat/route.ts").body.includes("Project knowledge:"), true);
check("a chat can be filed into a project", read("app/components/chat-menu-sheet.tsx").body.includes("Move to project"), true);
/* Opening an old chat has to restore the project it belongs to, or its
   instructions silently stop applying. */
check("opening a chat restores its project", /setActiveProjectId\(chat\.projectId \?\? null\)/.test(shell), true);
/* Third correction to the audit: starting a chat while a project is active
   already files it there. The persist path stamps the active project onto the
   chat, so no separate "add this one too" step is needed — I had reported this
   as missing as well. Pinned so the claim stays checkable. */
check("a new chat inherits the active project", /projectId: activeProjectId \?\? undefined/.test(shell), true);
/* But an existing chat that belongs to no project must open in no project.
   The restore path used to fall back to the last globally active project, and
   since the persist path stamps the active project onto every save, opening an
   unfiled chat quietly filed it into that project. The more projects were used,
   the more often it happened. */
check("restoring an unfiled chat does not adopt the last project",
  /setActiveProjectId\(requestedChat\.projectId \?\? null\)/.test(shell), true);
check("no path falls back to the stored project for a chat",
  /requestedChat\.projectId \?\? state\.activeProjectId/.test(shell), false);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
