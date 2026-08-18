import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const module_ = readFileSync(join(root, "lib/ui/overlay-route.ts"), "utf8");
const shell = stripComments(readFileSync(join(root, "app/components/app-shell.tsx"), "utf8"));
const composer = stripComments(readFileSync(join(root, "app/components/composer-dock.tsx"), "utf8"));

/* ── Every overlay is dismissable by the gesture people actually use ─────── */

/* On a phone, back is how you dismiss the thing in front of you. These were
   plain booleans, so back skipped the sheet entirely and navigated the chat
   underneath — or left the app when the chat was the first thing opened. An
   overlay added later without a route would reintroduce exactly that, silently,
   which is why this counts them rather than spot-checking. */
/* Voice is not on this list any more, and its absence is the change rather
   than an omission. It was a sheet with five controls in it; it is now a state
   the composer is in, with nothing covering the thread and nothing for back to
   dismiss. `/voice` still exists — it is the manifest shortcut — but it starts
   a conversation instead of opening a layer, so there is no layer to route. */
const SHELL_OVERLAYS = [
  "historyOpen", "settingsOpen", "connectorsOpen", "projectsOpen",
  "artifactsOpen", "chatMenuOpen", "effortSheetOpen"
];
for (const name of SHELL_OVERLAYS) {
  check(`${name} is dismissable by back`, new RegExp(`useOverlayRoute\\(\\{\\s*open:\\s*${name}\\b`).test(shell), true);
}
check("the message action sheet is dismissable by back", /useOverlayRoute\(\{\s*open:\s*contextMessage !== null/.test(shell), true);
check("the attachment menu is dismissable by back", /useOverlayRoute\(\{\s*open:\s*sourceMenuOpen\b/.test(composer), true);
check("the integrations sheet is dismissable by back", /useOverlayRoute\(\{\s*open:\s*integrationsOpen\b/.test(composer), true);

/* Every boolean the shell opens an overlay with should be accounted for. A new
   `somethingOpen` that never reaches this module is the regression. */
const declared = [...shell.matchAll(/const \[(\w+Open), set\w+\] = useState/g)].map((m) => m[1]);
const routed = new Set([...shell.matchAll(/useOverlayRoute\(\{\s*open:\s*(\w+)/g)].map((m) => m[1]));
const unrouted = declared.filter((name) => !routed.has(name));
check("no shell overlay is left out", unrouted, []);

/* ── The address follows the screen ─────────────────────────────────────── */

/* `/settings` opens the settings sheet, so closing it used to leave the URL
   naming a screen that was no longer showing — reload and it sprang open
   again. Each overlay with a route of its own now carries it. */
for (const [state, path] of [
  ["historyOpen", "/recents"], ["settingsOpen", "/settings"], ["connectorsOpen", "/connectors"],
  ["projectsOpen", "/projects"], ["artifactsOpen", "/artifacts"]
]) {
  const block = shell.slice(shell.indexOf(`open: ${state}`));
  check(`${state} carries ${path}`, block.slice(0, 260).includes(`path: "${path}"`), true);
}

/* A link straight to a sheet has nothing behind it, so closing must not walk
   off the end of the history and out of the app. */
/* The one route with no overlay behind it. It has to still do something, and
   what it does is the thing its manifest entry promises — start talking. */
check("/voice starts a conversation rather than opening a layer",
  /initialLayer !== "voice"[\s\S]{0,200}conversation\.start\(\)/.test(shell), true);
check("and nothing opens a voice sheet any more", /voiceOpen/.test(shell), false);

check("a linked sheet closes to somewhere in the app", /restore: restorePath/.test(shell), true);
check("the restore target is a chat that exists", /chats\.some\(\(chat\) => chat\.id === activeId\)/.test(shell), true);

/* ── The race that driving the app uncovered ─────────────────────────────── */

/* `history.back()` lands a tick later, and one sheet replacing another does
   both halves in a single render — Settings closes and Connectors opens from
   the same tap. Pushing before the back arrived unwound the entry that had
   just been added, dropping straight to the conversation. */
check("a push waits behind an outstanding back", module_.includes("function afterPending"), true);
check("the push actually goes through it", /afterPending\(\(\) => window\.history\.pushState/.test(module_), true);
check("popstate is what releases it, not a timer", /awaitingPop\.shift\(\);\s*\n\s*drain\(\);/.test(module_), true);
check("no timer is involved", /setTimeout|requestAnimationFrame/.test(module_), false);

/* Our own pops must not run a close handler that has already run, and pops we
   did not cause — moving between chats — must not close anything. */
check("an expected pop skips the close handler", /if \(awaitingPop\.length\) \{[\s\S]{0,120}return;/.test(module_), true);
check("an unrelated pop closes nothing", module_.includes("if (!frame) return;"), true);
check("a closed frame cannot be closed twice", module_.includes("frame.live = false"), true);

/* An overlay open on the first render arrived by route, so the navigation that
   brought us here is already its history entry. Pushing another would need two
   backs to leave one sheet. */
check("a route-opened overlay does not push a second entry", module_.includes("owned: !first"), true);
check("and it corrects the address in place instead", /if \(!frame\.owned\) \{[\s\S]{0,400}replaceState/.test(module_), true);

/* ── The keyboard equivalent ─────────────────────────────────────────────── */

check("escape closes the innermost overlay", /event\.key !== "Escape"/.test(module_), true);
check("escape respects a handler that already acted", module_.includes("event.defaultPrevented"), true);
check("escape closes one, not all", /const frame = stack\[stack\.length - 1\]/.test(module_), true);

/* ── Leaving for a route is not the same as dismissing ──────────────────── */

/* A drawer row that opens a real screen does both from one tap: it closes the
   drawer and it navigates. Closing normally unwinds the entry the drawer
   pushed — right for a dismissal, wrong here, because the unwind lands after
   the router has navigated and cancels it. Developer opened and bounced
   straight back to the conversation. */
const drawer = stripComments(readFileSync(join(root, "app/components/history-drawer.tsx"), "utf8"));

check("the module can be told a navigation is coming", module_.includes("export function releaseOverlaysForNavigation"), true);
check("a released frame leaves history alone", /if \(frame\.released\) \{[\s\S]{0,400}?stack\.splice\(index, 1\);[\s\S]{0,20}?return;/.test(module_), true);
/* The drawer no longer carries a Developer row — configuration left primary
   navigation — so the release-before-navigate rule now has to hold in the one
   place that still opens that route: the settings sheet. Same bug, same fix,
   asserted where the code actually lives. */
const settings = stripComments(readFileSync(join(root, "app/components/settings-sheet.tsx"), "utf8"));
/* Nothing in Settings opens a route any more — the Developer screen it used to
   push to has been deleted, so the release-before-navigate rule has no caller
   left here. What matters now is that nothing routes at all. */
check("the settings sheet no longer routes anywhere", /router\.push\(/.test(settings), false);
check("opening a chat releases them too", /releaseOverlaysForNavigation\(\);\s+setHistoryOpen\(false\);/.test(shell), true);

/* Belt and braces: even without the explicit signal, an entry that something
   else has pushed on top of must not be unwound by us. The id is stamped into
   the history entry when it is pushed so this can be checked, not assumed. */
check("each frame stamps its own id", /naviOverlay: frame\.id/.test(module_), true);
check("we only go back if our entry is still current", /\?\.naviOverlay === frame\.id/.test(module_), true);
check("otherwise the frame is dropped quietly", /if \(frame\.owned && !onTop\) \{/.test(module_), true);

/* ── The sidebar is content; Settings is configuration ───────────────────── */

/* The drawer used to swap Projects out for Developer and "Connectors and keys"
   whenever Code mode was on — configuration surfaces sitting in primary
   navigation, replacing the user's own content. Both live in Settings, and
   Settings → Developer now actually opens rather than bouncing back, so the
   sidebar can hold one rule: what you have, not how it is set up. */
check("no Developer row in the sidebar", /\n\s*Developer\n/.test(drawer), false);
check("no connectors row in the sidebar", /openSheet\(onConnectors\)/.test(drawer), false);
check("no Customize row", /openSheet\(onCustomize\)/.test(drawer), false);
check("it is no longer named after a screen that does not exist", /\n\s*Repository\n/.test(drawer), false);
/* Projects is content, so it is present in both modes rather than being the
   row that gets displaced. */
check("Projects is in the sidebar", /openSheet\(onProjects\)/.test(drawer), true);
check("the mode no longer decides the nav rows", /mode === "code" \? \(/.test(drawer), false);
/* Both destinations remain reachable, one level in. */
check("Settings still offers Connectors", /RootRow label="Connectors"/.test(settings), true);
check("Developer is gone from Settings", /RootRow label="Developer"/.test(settings), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
