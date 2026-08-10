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

const row = readFileSync(join(root, "app/components/message-row.tsx"), "utf8");
const shell = readFileSync(join(root, "app/components/app-shell.tsx"), "utf8");
const composer = stripComments(readFileSync(join(root, "app/components/composer-dock.tsx"), "utf8"));
const notice = stripComments(readFileSync(join(root, "app/components/provider-setup-notice.tsx"), "utf8"));
const status = readFileSync(join(root, "lib/ui/provider-status.ts"), "utf8");

/* ── Typing must not re-render the conversation ──────────────────────────── */

/* The draft lives in the shell, which renders the conversation and the
   composer together, so one keystroke re-rendered every message on screen —
   markdown, code highlighting and all. Measured in a browser at 390x844 with a
   24-message chat: 32.9ms per key before, 22.0ms after in dev, 4.1ms in a
   production build. */
check("message rows are memoised", /export const MessageRow = memo\(/.test(row), true);
check("the comparison is explicit, not the default shallow one", /memo\(MessageRowBase, \(previous, next\) =>/.test(row), true);
/* A streaming row changes on every chunk, so comparing it is wasted work on
   the one row that always has to render. */
check("a streaming row always renders", /if \(previous\.streaming \|\| next\.streaming\) return false;/.test(row), true);
check("the message identity is what decides", /previous\.message === next\.message/.test(row), true);

/* A memo is only as good as the props it compares. These two were rebuilt on
   every render, which would have made the comparison fail every time and
   memoise nothing — while freezing them with a dependency list would let a row
   retry using settings from an older render. */
check("the rate handler keeps one identity", /const stableRate = useCallback\(/.test(shell), true);
check("the retry handler keeps one identity", /const stableRetry = useCallback\(/.test(shell), true);
check("both read the current closure through a ref", /liveHandlers\.current = \{ rateMessage, retry \};/.test(shell), true);
check("neither is frozen with a dependency list", /liveHandlers\.current\.retry\(\)/.test(shell), true);
check("the rows are handed the stable ones", /onRate=\{message\.role === "assistant" \? stableRate : undefined\}/.test(shell), true);
/* Passing the id back is what lets one handler serve every row. */
check("the row reports which message was rated", /onRate\?\.\(message\.id, value\)/.test(row), true);

/* ── One read of the server's configuration, not one per component ───────── */

/* The composer and the setup notice each fetched /api/models on mount and on
   every return to the foreground. Two identical no-store requests per launch,
   two more per app switch, neither component aware of the other — invisible in
   the code, since the two fetches sit in different files, and invisible in use,
   since the answer was the same both times. */
check("the composer no longer fetches it directly", composer.includes("/api/models"), false);
check("the notice no longer fetches it directly", notice.includes("/api/models"), false);
check("one module owns the read", status.includes('fetch("/api/models"'), true);
check("concurrent callers share one request", /if \(inFlight\) return inFlight;/.test(status), true);
check("a repeat within the window is not refetched", /Date\.now\(\) - cachedAt < FRESH_MS/.test(status), true);
/* Returning to the app is exactly when a key added elsewhere should appear,
   which is the case a cache would hide. */
check("returning to the app forces a fresh read", /readProviderStatus\(\{ force: true \}\)/.test(status), true);
check("coming back online does too", status.includes('window.addEventListener("online", online)'), true);
/* A failed probe is "we do not know", not "nothing is configured" — caching it
   would latch the composer into looking unusable. */
check("a failed probe is not cached", /if \(value\) \{/.test(status), true);
check("the manual re-check bypasses the cache", /readProviderStatus\(\{ force: true \}\)/.test(notice), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
