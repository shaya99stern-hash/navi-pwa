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
/* Pages get renamed. A `throw` here ended the run on the first one and hid the
   forty assertions after it, which is the opposite of what a suite is for — the
   redesign renamed `account` to `profile` and this file reported nothing else
   at all. Aliases are followed, a genuinely missing page is reported as one
   failed check, and the rest of the file still runs.

   Both render forms are accepted: `? (` and `&& (`. */
const ALIASES = { account: ["account", "profile"] };
const block = (name) => {
  for (const candidate of ALIASES[name] ?? [name]) {
    for (const opener of [`{page === "${candidate}" ? (`, `{page === "${candidate}" && (`]) {
      const start = body.indexOf(opener);
      if (start === -1) continue;
      const next = body.indexOf('{page === "', start + 10);
      return body.slice(start, next === -1 ? undefined : next);
    }
  }
  check(`a page block exists for ${name}`, false, true);
  return "";
};

const diagnosticsPage = block("diagnostics");
check("the engine pin moved here", diagnosticsPage.includes("DIAGNOSTIC_ROUTES"), true);
check("the quality check moved here", diagnosticsPage.includes("Run quality check"), true);
/* A pin disables automatic routing for every request and is invisible from
   every other screen, so the page that sets it must also offer to clear it. */
check("a pin can be cleared from the same page", /routeOverride: undefined/.test(diagnosticsPage), true);

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

/* The single "What is stored" section became two, because it was answering two
   questions with one number. The device count is always knowable; the account
   count is knowable only when a store is configured and someone is signed in,
   and collapsing them printed `Conversations 0` beside a drawer listing five. */
check("the account mirror is stated separately", privacy.includes("Synced to your account"), true);
check("it is not on General", general.includes("On this device"), false);
/* The device count reads the same array the drawer renders, so the two screens
   cannot disagree about a number the user can see in both. */
check("Privacy can forget a fact", /forget\(item\.id\)/.test(privacy), true);
check("Privacy states the not-configured case", privacy.includes("Not enabled"), true);
check("Privacy states the empty case", privacy.includes("Nothing yet"), true);

/* ---- One subject, read top to bottom --------------------------------- */

/* Four sections covered one topic in the order the features were built: a
   paragraph, the facts list, the switches, then counts referring to "the list
   above" across an intervening section — with the storage-durability sentence
   printed twice, once under a toggle and once as a row of its own. */
const heads = [...privacy.matchAll(/<SectionHeader>(.*?)<\/SectionHeader>/g)].map((m) => m[1]);
check("the facts list follows its own count", privacy.indexOf("Synced to your account") < privacy.indexOf("forget(item.id)"), true);
check("the durability sentence appears once", (privacy.match(/DURABILITY_DETAIL\[durability\]/g) ?? []).length, 1);
/* A count that pointed at a list a section away, when the list is now directly
   beneath it. */
check("no count refers to a list that moved", privacy.includes("listed above"), false);
check("counts are tabular so a column stays aligned", /<Count value=/.test(privacy), true);

/* Both kinds of stored knowledge are shown, and shown apart: a skill carries
   the user's authority, a lesson only its own reasoning. */
check("taught skills are listed", /memoryStatus\.skillNames/.test(body), true);
check("self-learned lessons are listed separately", /memoryStatus\.lessonNames/.test(body), true);
/* Forgetting is a privacy decision; showing it as done before the server
   confirms is the one lie this control must not tell. */
check("the row waits for the server", /if \(response\?\.ok\) setFacts/.test(body), true);

/* A fixed height plus top padding leaves 52px minus the safe area for the
   title, which on a notched iPhone is nearly nothing — the header rendered
   clipped under the status bar. */
check("the old fixed height is gone", /flex h-\[52px\] shrink-0 items-center gap-1 border-b/.test(body), false);

/* ---- Two panes at 768px ---------------------------------------------- */

check("the section list is a nav landmark", body.includes('aria-label="Settings sections"'), true);
check("it has a fixed column width at md", /md:w-\[264px\]/.test(body), true);
check("the panes are divided", /md:border-r/.test(body), true);
/* On a phone the list is the whole sheet and a section replaces it; the same
   markup has to do both, so the hiding is conditional rather than absolute. */
/* Back points at a list that is already on screen at two panes. */
check("the back button is mobile-only", /aria-label="Back to Settings"[\s\S]{0,220}md:hidden/.test(body), true);
/* A chevron promises a drill-down, which is not what happens at two panes. */
check("the selected row is marked for assistive tech", body.includes('aria-current={active ? "page" : undefined}'), true);

/* ---- Every surface is reachable from the list ------------------------ */

/* The defect this guards: `/settings/Developer` shipped with no row leading
   to it, so the app looked like it had no developer surface — and asked
   where it was, the assistant invented a menu path that did not exist.
   A screen nothing navigates to is a screen that does not exist. */
/* The Developer screen is gone. It was a path box, a textarea and a commit
   button — a text editor on a phone, and a worse one than telling Navi Soul in
   Code mode to make the change, which reads the file and commits it itself.
   Two ways to do one thing, where the worse way was the one with a menu entry. */
check("no Developer row", /RootRow label="Developer"/.test(code), false);
check("nothing routes to the deleted screen", body.includes("/settings/Developer"), false);
check("developer is no longer a section", read("lib/ai/types.ts").body.includes('| "developer"'), false);
/* The deployment variables were the one thing on that screen worth keeping,
   so they moved to Diagnostics rather than being deleted with it. */
check("the deployment variables survived", body.includes("Deployment variables"), true);
check("they are on Diagnostics", block("diagnostics").includes("NAVI_SELF_UPDATE_BRANCH"), true);
/* A persisted `lastMenuSection` of "developer" must open the list, not a pane
   that renders nothing. */
check("a retired section falls back to the root list",
  /initialSection && initialSection in PAGE_TITLES \? initialSection : "root"/.test(body), true);
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
check("the three switches share one group", (capabilities.match(/<SettingsToggle/g) ?? []).length, 3);
check("no heading repeats its own row label", capHeads.includes("Code execution and file creation"), false);
check("web search still toggles", /tools, web: !preferences\.tools\.web/.test(capabilities), true);
check("artifacts still toggles", /tools, artifacts: !preferences\.tools\.artifacts/.test(capabilities), true);
check("code execution still toggles", /tools, code: !preferences\.tools\.code/.test(capabilities), true);

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

/* ── Every switch must reach something ───────────────────────────────────────
   The Motion control wrote `data-motion` onto the root element and no rule in
   the stylesheet ever read it, so moving the switch changed an attribute and
   not one animation. A setting that describes a behaviour it does not have is
   worse than no setting: it teaches the user that the others are decoration
   too. The OS media query is not a substitute — that is a different input. */
const css = read("app/globals.css").source;
check("the Motion control writes the attribute", shellSource.includes("dataset.motion = preferences.motion"), true);
check("a stylesheet rule reads the attribute", css.includes('[data-motion="reduced"]'), true);
check("the attribute shortens animations, not only transitions",
  /\[data-motion="reduced"\][\s\S]{0,400}animation-duration/.test(css), true);

/* ── Teaching without a tool call in the way ─────────────────────────────
   Asking Navi Soul to learn something went through `learn_skill`, so it
   depended on the model choosing the tool, filling it correctly, and
   reporting the result honestly — and when the write failed it narrated a
   theory instead of the reason. The same request appears five times in the
   exported history. This writes to the same store through the same API and
   shows whatever the server actually says. */
const skills = block("capabilities");
/* The Skills page merged into Capabilities in the redesign. Teaching still has
   to be reachable in one place — asserted by the control that saves, not by the
   heading above it. */
check("Skills offers a direct teach path", /void saveSkill\(\)/.test(skills), true);
check("it posts to the real store", /fetch\("\/api\/memory\/skills"/.test(body), true);
check("it reports the server's own message", /data\?\.error \?\? `The store answered/.test(body), true);
check("a name and instructions are both required",
  /!teach\.name\.trim\(\) \|\| !teach\.instructions\.trim\(\)/.test(body), true);

/* ── What is broken, without asking the assistant ────────────────────────
   `diagnose_self` gives the model the same answer, and that is the one that
   stops it inventing a cause. But the turn where you most need it is the turn
   where something in that path may be the broken thing, so there has to be a
   way that needs no model and no conversation. It runs the identical checks
   rather than a parallel set — two implementations of "what is broken" would
   drift, and the first time they disagreed nobody would know which to trust. */
check("Diagnostics can run every check", diagnosticsPage.includes("Run all checks"), true);
check("it calls the shared route", /fetch\("\/api\/system\/diagnostics"/.test(body), true);
check("the route reuses the model's own checks",
  read("app/api/system/diagnostics/route.ts").body.includes("runAllChecks"), true);
check("the tool and the screen share one implementation",
  read("lib/ai/diagnostic-tools.ts").body.includes("export async function runAllChecks"), true);

/* ── Arrangement pins removed, deliberately ─────────────────────────────────
   Twelve assertions used to live here describing a master/detail Settings
   layout: which section sat on which page, in what order, which element carried
   the safe-area inset, when the detail pane was hidden. The owner replaced that
   layout wholesale.

   Re-deriving those assertions from the new design would have meant guessing at
   intent and re-imposing the old arrangement through the back door — a test
   asserting a layout choice is only worth having when the choice is load
   bearing, and these were not. What remains asserts *function*: that a page
   exists, that a control reaches its handler, that a destructive action
   confirms, that data fetched is data shown.

   The one lesson kept from them: a page rename must not end the run. `block`
   above follows aliases and reports a genuinely missing page as one failed
   check, because the previous version threw and hid forty assertions behind it.
*/

/* ── The app does not contradict itself about where chats live ──────────────
   The Account section promised "chats and settings sync to your private cloud
   memory" unconditionally, while the Memory section three screens down was
   simultaneously offering "Cloud memory is off. Nothing leaves this device."
   One of the two was always lying, and which one depended on a deployment
   variable that neither of them read.

   That is the pattern this app keeps producing: prose describing configuration
   drifts away from the code that reads it, and nothing fails when it does. So
   the assertion is not about the wording — it is that both sections take the
   answer from the same place. */

check("the account copy is derived, not asserted", code.includes("const cloudReady = memoryStatus.loaded && memoryStatus.configured"), true);
check("it reads the same status the memory section does", /syncedDescription[\s\S]{0,400}memoryStatus\.loaded/.test(code), true);
check("no unconditional promise of sync survives",
  /description=\{`\$\{account\.email[^}]*Chats and settings sync/.test(code), false);
/* Neither promise is made while the answer is still being fetched. */
check("an unloaded status promises nothing", code.includes('"Checking where your chats are kept…"'), true);
/* And the section that was already honest stays honest. */
check("the memory section still names the off state", body.includes("Cloud memory is off"), true);

/* ── A failure nobody can see is one nobody fixes ─────────────────────────── */

/* `if (!response.ok) return null;` swallowed every PostgREST answer alike: a
   401 from an expired third-party auth registration, a 404 from a missing
   table, and a 403 from a policy refusing the row all arrived at the caller as
   the same quiet null. Cloud memory sat broken for a week with the app
   reporting nothing at all. The status code alone separates all three. */
const cloud = read("lib/memory/cloud.ts");
check("a failed request is logged", /console\.warn\(`Cloud memory/.test(cloud.body), true);
check("with the status code", /answered \$\{response\.status\}/.test(cloud.body), true);
check("and PostgREST's own reason", /response\.text\(\)/.test(cloud.body), true);
/* Still a null to the caller — memory is an enhancement, and a database error
   is not something to put in front of the user. */
check("the caller still sees a null", /console\.warn\(`Cloud memory[\s\S]{0,200}return null;/.test(cloud.body), true);
/* The timeout above doing its job is not a fault worth a line on every slow
   network. */
check("a timeout is not logged as a fault", cloud.body.includes('error.name === "AbortError"'), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
