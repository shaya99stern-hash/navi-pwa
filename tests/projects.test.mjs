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
check("the form collects instructions too", sheet.includes("navi-project-instructions"), true);
/* A project with no name is the bug this fixes; a project with no
   instructions is a legitimate choice. Only the name is required. */
check("a nameless project cannot be created", /disabled=\{!draft\.name\.trim\(\)\}/.test(sheet), true);
check("instructions are optional", sheet.includes("Optional, and editable later."), true);
/* Created and selected in one act. Having to find a second button to actually
   use the project is where the flow was being abandoned. */
check("creating also selects it for this conversation", /onCreate\(project\)[\s\S]{0,400}onSelect\(project\.id\)/.test(sheet), true);

/* ---- Projects are visible in the sidebar ------------------------------- */

/* They lived only behind a sheet, so a project was something you made once and
   never saw again. A project you cannot see is one you never file into. */
check("the drawer takes projects", /projects: NaviProject\[\]/.test(drawer), true);
check("the drawer lists them", /projects\.slice\(0, 6\)\.map/.test(drawer), true);
check("each row shows its conversation count", drawer.includes("No conversations yet"), true);
check("the active project is marked", /activeProjectId === project\.id/.test(drawer), true);
/* Search ranks across everything; a pinned section above the results would
   push the actual matches off screen. */
check("the section hides while searching", /!normalized && projects\.length/.test(drawer), true);
check("there is still a way to all projects", /openSheet\(onProjects\)/.test(drawer), true);

/* ---- Opening one is a single act -------------------------------------- */

check("the shell passes projects to the drawer", /projects=\{projects\}/.test(shell), true);
check("opening a project selects it and shows it", /setActiveProjectId\(id\); setProjectsOpen\(true\)/.test(shell), true);

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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
