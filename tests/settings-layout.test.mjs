import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const { source, body } = read("app/components/settings-sheet.tsx");
const code = stripComments(source);

/* ---- Diagnostics are hidden, and stay hidden ------------------------- */

check("a diagnostics page exists", body.includes('page === "diagnostics"'), true);
check("it is reached by a gesture, not a row", /RootRow label="Diagnostics"/.test(code), false);
check("five taps open it", body.includes("DIAGNOSTICS_TAPS = 5"), true);
/* Without a window, four stray taps across a session leave the page one tap
   from opening months later for someone who never intended it. */
check("the taps must be consecutive in time", body.includes("DIAGNOSTICS_TAP_WINDOW_MS"), true);
check("the window is checked, not just declared", /now - lastTapAt\.current > DIAGNOSTICS_TAP_WINDOW_MS/.test(body), true);

/* `MenuSection` is what gets persisted as `lastMenuSection` and reopened next
   time. A hidden page that reopens itself is not hidden. */
check("diagnostics is not a persisted section", /"diagnostics"[\s\S]{0,80}\|\s*"general"/.test(read("lib/ai/types.ts").body), false);
check("opening it does not persist a section", /setPage\("diagnostics"\)/.test(body), true);

/* ---- What moved there ------------------------------------------------ */

/* Anchored on the block opener, not on `page === "x"` alone. The section list
   renders `active={page === "x"}` for every row, so the bare comparison first
   matches a nav row hundreds of lines above the page it names — which sliced an
   empty range and passed the absence checks below for the wrong reason. */
const block = (name) => {
  const start = body.indexOf(`{page === "${name}" ? (`);
  if (start === -1) throw new Error(`no page block for ${name}`);
  const next = body.indexOf("{page === \"", start + 10);
  return body.slice(start, next === -1 ? undefined : next);
};

const diagnosticsPage = block("diagnostics");
check("the engine pin moved here", diagnosticsPage.includes("DIAGNOSTIC_ROUTES"), true);
check("the quality check moved here", diagnosticsPage.includes("Run quality check"), true);
/* A pin disables automatic routing for every request and is invisible from
   every other screen, so the page that sets it must also offer to clear it. */
check("a pin can be cleared from the same page", /routeOverride: undefined/.test(diagnosticsPage), true);
check("the page says a pin makes answers worse", /makes answers worse|will not improve/.test(diagnosticsPage), true);

const capabilities = block("capabilities");
check("the engine pin is gone from Capabilities", capabilities.includes("DIAGNOSTIC_ROUTES"), false);

const account = block("account");
check("the quality check is gone from Account", account.includes("Run quality check"), false);

/* ---- The memory list is on the page it belongs to -------------------- */

/* It shipped on the wrong page. The insert was anchored on a "Preferences"
   section header, which exists on both General and Privacy, and matched
   General's first. The test that should have caught it only asserted the file
   contained the section — which was true, on the wrong screen. Assert the page
   it renders in, not its presence. */
const privacy = block("privacy");
const general = block("general");

check("the memory list is on Privacy", privacy.includes("What is stored"), true);
check("it is not on General", general.includes("What is stored"), false);
check("Privacy can forget a fact", /forget\(item\.id\)/.test(privacy), true);
check("Privacy states the not-configured case", privacy.includes("Not enabled"), true);
check("Privacy states the empty case", privacy.includes("Nothing yet"), true);

/* ---- One subject, read top to bottom --------------------------------- */

/* Four sections covered one topic in the order the features were built: a
   paragraph, the facts list, the switches, then counts referring to "the list
   above" across an intervening section — with the storage-durability sentence
   printed twice, once under a toggle and once as a row of its own. */
const heads = [...privacy.matchAll(/<SectionHeader>(.*?)<\/SectionHeader>/g)].map((m) => m[1]);
check("Privacy is three sections, not four", heads, ["Memory", "What is stored", "Your data"]);
check("the switches come before what they govern", privacy.indexOf("Local history") < privacy.indexOf("What is stored"), true);
check("the facts list follows its own count", privacy.indexOf("What is stored") < privacy.indexOf("forget(item.id)"), true);
check("the durability sentence appears once", (privacy.match(/DURABILITY_DETAIL\[durability\]/g) ?? []).length, 1);
/* A count that pointed at a list a section away, when the list is now directly
   beneath it. */
check("no count refers to a list that moved", privacy.includes("listed above"), false);
check("counts are tabular so a column stays aligned", /<Count value=/.test(privacy), true);

/* Both kinds of stored knowledge are shown, and shown apart: a skill carries
   the user's authority, a lesson only its own reasoning. */
check("taught skills are listed", privacy.includes("skillNames.map"), true);
check("self-learned lessons are listed separately", privacy.includes("lessonNames.map"), true);
/* Forgetting is a privacy decision; showing it as done before the server
   confirms is the one lie this control must not tell. */
check("the row waits for the server", /if \(response\?\.ok\) setFacts/.test(body), true);

/* A fixed height plus top padding leaves 52px minus the safe area for the
   title, which on a notched iPhone is nearly nothing — the header rendered
   clipped under the status bar. */
check("the sheet header adds the safe area to its height", /h-\[calc\(52px\+var\(--safe-top\)\)\]/.test(body), true);
check("the old fixed height is gone", /flex h-\[52px\] shrink-0 items-center gap-1 border-b/.test(body), false);

/* ---- Two panes at 768px ---------------------------------------------- */

check("the section list is a nav landmark", body.includes('aria-label="Settings sections"'), true);
check("it has a fixed column width at md", /md:w-\[264px\]/.test(body), true);
check("the panes are divided", /md:border-r/.test(body), true);
/* On a phone the list is the whole sheet and a section replaces it; the same
   markup has to do both, so the hiding is conditional rather than absolute. */
check("the list fills the sheet at root on mobile", /page === "root" \? "w-full" : "hidden"/.test(body), true);
check("the pane is hidden at root on mobile only", /page === "root" \? "hidden md:block" : ""/.test(body), true);
/* Back points at a list that is already on screen at two panes. */
check("the back button is mobile-only", /aria-label="Back to Settings"[\s\S]{0,220}md:hidden/.test(body), true);
/* A chevron promises a drill-down, which is not what happens at two panes. */
check("the row chevron is mobile-only", /ChevronRight[^\n]*md:hidden/.test(body), true);
check("the selected row is marked for assistive tech", body.includes('aria-current={active ? "page" : undefined}'), true);
check("an empty pane says what it is for", body.includes("Choose a section."), true);

/* ---- Every surface is reachable from the list ------------------------ */

/* The defect this guards: `/settings/Developer` shipped with no row leading
   to it, so the app looked like it had no developer surface — and asked
   where it was, the assistant invented a menu path that did not exist.
   A screen nothing navigates to is a screen that does not exist. */
check("a Developer row exists", /RootRow label="Developer"/.test(code), true);
check("it navigates to the real route", body.includes('router.push("/settings/Developer")'), true);
check("developer is a known section", read("lib/ai/types.ts").body.includes('| "developer"'), true);
/* Persisted sections are reopened on the next visit. Developer is a route,
   not a pane, so persisting it would reopen Settings onto a blank pane. */
check("opening Developer does not persist a pane", /next === "developer"[\s\S]{0,200}router\.push/.test(body), true);
check("the stored-section allow-list accepts it", read("lib/storage/indexeddb.ts").body.includes('"developer"'), true);

/* Connectors is the other route-not-a-pane row; it must keep working. */
check("Connectors still opens its own sheet", body.includes("onOpenConnectors()"), true);

/* ---- Four headings for three switches ------------------------------- */

/* Capabilities had a section header per row — "General", "Visuals", "Code
   execution and file creation", "Accounts" — one row under each, and the third
   heading repeated its own row's label word for word. Four headings to
   organise three switches is the taxonomy costing more than the thing being
   classified, on a screen whose title already says what all three are. */
const capHeads = [...capabilities.matchAll(/<SectionHeader>(.*?)<\/SectionHeader>/g)].map((m) => m[1]);
check("Capabilities is two sections, not four", capHeads.length, 2);
check("the three switches share one group", (capabilities.match(/<SettingsToggle/g) ?? []).length, 3);
check("no heading repeats its own row label", capHeads.includes("Code execution and file creation"), false);
check("web search still toggles", /tools, web: !preferences\.tools\.web/.test(capabilities), true);
check("artifacts still toggles", /tools, artifacts: !preferences\.tools\.artifacts/.test(capabilities), true);
check("code execution still toggles", /tools, code: !preferences\.tools\.code/.test(capabilities), true);
check("connecting an account is still one tap away", /openPage\("connectors"\)/.test(capabilities), true);

/* ---- The research banner ---------------------------------------------- */

/* It was the only place the state was visible, so it earned a stripe across
   the top. The composer now carries a research toggle that lights up when it
   is on — at the point of use — so the banner became a second announcement of
   something already on screen, pushing the conversation down to say it. */
const shellSource = read("app/components/app-shell.tsx").source;
check("no research banner across the top", shellSource.includes("Research mode on ·"), false);
check("the offline banner stays", shellSource.includes("Offline · chats, projects, and drafts"), true);
check("the project banner stays", shellSource.includes("Project: {activeProject.name}"), true);
const composerSource = read("app/components/composer-dock.tsx").source;
check("the composer still shows the state", /Research is \$\{research \? "on" : "off"\}|Research is on|research \?/.test(composerSource), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
