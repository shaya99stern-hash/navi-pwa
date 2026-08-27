import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const chat = read("app/api/chat/route.ts");
const row = read("app/components/message-row.tsx");
const composer = read("app/components/composer-dock.tsx");
const updater = read("app/pwa-register.tsx");

/* ── Selective execution ───────────────────────────────────────────────── */

check("the live executor has a deterministic execution profile",
  /compileExecutionProfile/.test(chat.code), true);
check("the execution profile can skip memory preparation",
  /executionProfile\.includeMemory/.test(chat.code), true);
check("the execution profile can skip model-visible tools",
  /executionProfile\.includeTools/.test(chat.code), true);
check("trivial turns are explicitly recognized before heavyweight preparation",
  /turnBudget\.class === ["']trivial["']/.test(chat.code), true);

/* ── Natural streaming ─────────────────────────────────────────────────── */

check("chat streaming no longer forces the old 26ms per-word delay",
  /delayInMs:\s*26/.test(chat.code), false);
check("chat streaming no longer forces word-sized chunks",
  /chunking:\s*["']word["']/.test(chat.code), false);

/* ── Calm chat is owned by components, not fragile CSS selectors ───────── */

check("assistant copy has an explicit stable hook",
  /navi-assistant-copy/.test(row.code), true);
check("response actions have an explicit stable hook",
  /navi-response-actions/.test(row.code), true);
check("response metadata has an explicit stable hook",
  /navi-response-meta/.test(row.code), true);
check("routine AI disclaimer is not permanently rendered below every composer",
  /Navi Soul is AI and can make mistakes/.test(composer.code), false);

/* ── Installed PWA does not remain on a stale shell indefinitely ───────── */

check("automatic update checks do not merely leave a waiting worker parked",
  /if \(registration\.waiting\) \{\s*if \(manual\) applyWaitingWorker\(\);\s*else showAvailable\(\);/s.test(updater.code), false);
check("resume handling can apply a waiting worker after the app was backgrounded",
  /visibilityCheck[\s\S]{0,900}applyWaitingWorker\(\)/.test(updater.code), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
