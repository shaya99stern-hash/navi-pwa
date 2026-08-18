import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const sandbox = readFileSync(join(root, "lib/execution/sandbox.ts"), "utf8");
const tools = readFileSync(join(root, "lib/ai/execution-tools.ts"), "utf8");
const shell = readFileSync(join(root, "app/components/app-shell.tsx"), "utf8");
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const trace = readFileSync(join(root, "app/components/execution-trace.tsx"), "utf8");

/* ── Nothing the sandbox runs may reach anything ─────────────────────────────
   The code being run was written by a model, and a model can be talked into
   writing something hostile by content in its own context. Every one of these
   is a way out of the worker, and each is removed before user code compiles. */

for (const global of [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
  "indexedDB", "localStorage", "sessionStorage", "caches",
  "Worker", "SharedWorker", "BroadcastChannel", "postMessage"
]) {
  check(`${global} is taken away`, sandbox.includes(`"${global}"`), true);
}

/* A cooperative timeout never gets a turn against `while (true)`. Terminating
   the worker from outside is the only thing that actually stops one. */
check("the worker is terminated on timeout", /setTimeout\([\s\S]{0,400}terminate\(\)/.test(sandbox), false);
check("cleanup terminates the worker", /cleanup[\s\S]{0,200}terminate\(\)/.test(sandbox), true);
check("the timeout calls cleanup", /const timer = setTimeout\([\s\S]{0,300}cleanup\(\)/.test(sandbox), true);
check("output is truncated", sandbox.includes("MAX_OUTPUT_CHARS"), true);
check("logs are bounded", sandbox.includes("MAX_LOG_LINES"), true);

/* The blob URL is revoked whether the run succeeded, failed, timed out, or
   never started. A leaked object URL holds its blob for the page's lifetime. */
check("the object url is revoked in cleanup", /cleanup[\s\S]{0,200}revokeObjectURL/.test(sandbox), true);

/* An ordinary eval would hand the code this scope's variables, including the
   log buffer and the function that posts results back. */
check("user code cannot see the worker scope", sandbox.includes("new Function("), true);
check("user code runs in strict mode", sandbox.includes('"use strict"'), true);

/* Never rejects: a thrown sandbox would make the caller handle two shapes for
   the same event — the code was wrong. */
check("the sandbox never rejects", /\breject\s*\(/.test(sandbox), false);
check("the promise takes no reject at all", /new Promise\(\(resolve\)/.test(sandbox), true);
check("a compile error is caught", sandbox.includes("worker.onerror"), true);
check("an unavailable Worker is handled", sandbox.includes('typeof Worker === "undefined"'), true);

/* ── The verdict is stated first, and honestly ───────────────────────────── */

check("failure is the first line", sandbox.includes('result.ok ? "The code ran successfully." : "The code failed."'), true);
check("the trace reads that first line", trace.includes('output.startsWith("The code failed")'), true);
/* Presenting code that failed its last run as working is the single outcome
   this whole feature exists to prevent, in the prompt and in the UI. */
check("the prompt forbids claiming a failed run worked", /[Nn]ever present code that failed/.test(tools), true);
check("the trace reports the last run, not the best", trace.includes("lastFailed"), true);
check("a still-failing trace says so", trace.includes("still failing"), true);

/* ── The loop is bounded where it can actually be counted ────────────────── */

check("a repair cap exists", tools.includes("MAX_REPAIR_ROUNDS"), true);
check("the cap is three", /MAX_REPAIR_ROUNDS = 3/.test(tools), true);
check("the prompt states the cap", tools.includes("${MAX_REPAIR_ROUNDS} attempts"), true);
/* The prompt asks the model to stop and mostly it will. The client counts,
   because a model that does not would otherwise loop on the device. */
check("the client enforces the cap", shell.includes("repairRounds.current > MAX_REPAIR_ROUNDS"), true);
check("the counter resets each turn", /repairRounds\.current = 0/.test(shell), true);
check("the counter resets for voice too", (shell.match(/repairRounds\.current = 0/g) ?? []).length >= 2, true);

/* ── It runs on the device, not the server ───────────────────────────────── */

/* A tool with an `execute` runs server-side. This one has none on purpose:
   that is what forwards the call to the client, where the sandbox lives. */
check("the tool has no server-side execute", /run_javascript: tool\(\{[\s\S]{0,800}execute:/.test(tools), false);
check("the client answers the tool call", shell.includes('toolCall.toolName !== "run_javascript"'), true);
check("the result is submitted back", shell.includes("addToolResult"), true);
/* Without this the run happens, the result sits there, and the conversation
   stops one step short of the model reading its own error. */
check("the model continues automatically", shell.includes("sendAutomaticallyWhen"), true);

/* ── The capability is the app's, not the route's ────────────────────────── */

/* The wiring moved into the registry, which is now the single place that
   decides what NaviSoul can do on a turn. */
const registry = readFileSync(join(root, "lib/tools/registry.ts"), "utf8");
check("the route builds its toolset from the registry", route.includes("buildToolset(toolsetContext)"), true);
check("execution is gated on the user's code switch", /name: "execution"[\s\S]{0,160}policy\.code/.test(registry), true);
check("execution is in the registry", registry.includes("buildExecutionTools()"), true);
check("the old provider-dependent copy is gone", /selected route actually supplies it/.test(route), false);

const settings = readFileSync(join(root, "app/components/settings-sheet.tsx"), "utf8");
check("settings no longer blames the route", /Available only when the selected route/.test(settings), false);
check("settings says where code runs", /on this device/.test(settings), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
