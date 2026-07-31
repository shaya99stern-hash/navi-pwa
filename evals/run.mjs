#!/usr/bin/env node
/**
 * Scores the app's answers against a fixed task set.
 *
 * The point is to replace "that felt smarter" with a number. Every task is one
 * a model gets wrong by approximating and a tool gets right by computing, so
 * the score moves when tool use actually works — not when a prompt is reworded.
 *
 *   node evals/run.mjs                        # against a local dev/prod server
 *   node evals/run.mjs --base https://…       # against a deployment
 *   node evals/run.mjs --no-tools             # baseline, for comparison
 *
 * Needs a running server with provider credentials. Without them every task
 * fails at the request, which the report states rather than scoring as 0.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(here, "tasks.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const preset = flag("preset", "auto");
const withTools = !args.includes("--no-tools");
const cookie = flag("cookie", process.env.NAVI_EVAL_COOKIE ?? "");

/** Drains the UI message stream and returns just the assistant's text. */
async function ask(prompt) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The API refuses cross-origin mutations, so present as the app itself.
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify({
      id: `eval-${Math.random().toString(36).slice(2)}`,
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: prompt }] }],
      preset,
      style: "balanced",
      tools: { web: withTools, code: false, artifacts: false },
      connectorAccessMode: "ask",
      connectedMcpServers: []
    })
  });
  if (response.status === 401 || response.status === 403 || response.status === 503) {
    throw new Error(
      `HTTP ${response.status} — the request never reached a model. `
      + `401/403 means a signed-in session is needed: pass --cookie "<session cookie>" or set NAVI_EVAL_COOKIE. `
      + `503 means the deployment's auth or provider credentials are not configured.`
    );
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);

  let text = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        if (chunk.type === "text-delta" && typeof chunk.delta === "string") text += chunk.delta;
      } catch {
        // Partial frame; the next read completes it.
      }
    }
  }
  return text.trim();
}

function grade(task, answer) {
  const { type, value } = task.expect;
  if (type === "regex") return new RegExp(value, "i").test(answer);
  return answer.toLowerCase().includes(String(value).toLowerCase());
}

const results = [];
let passed = 0;
let errored = 0;

for (const task of tasks) {
  process.stdout.write(`  ${task.id.padEnd(22)}`);
  try {
    const started = Date.now();
    const answer = await ask(task.prompt);
    const ok = grade(task, answer);
    if (ok) passed += 1;
    results.push({ id: task.id, ok, ms: Date.now() - started, answer: answer.slice(0, 160) });
    process.stdout.write(`${ok ? "pass" : "FAIL"}  ${Date.now() - started}ms\n`);
    if (!ok) process.stdout.write(`      expected ${task.expect.type} ${JSON.stringify(task.expect.value)}\n      got: ${answer.slice(0, 160)}\n`);
  } catch (error) {
    errored += 1;
    results.push({ id: task.id, ok: false, error: error.message });
    process.stdout.write(`ERROR  ${error.message.slice(0, 90)}\n`);
  }
}

const scored = tasks.length - errored;
console.log(`\n${passed}/${tasks.length} passed  (tools ${withTools ? "on" : "off"}, preset ${preset})`);
if (errored) {
  console.log(`${errored} task(s) never reached the model — check that ${base} is running, signed in, and has provider credentials.`);
  console.log("Those are not scored as wrong answers; the run is inconclusive until they succeed.");
}
if (scored > 0) console.log(`Score over tasks that ran: ${passed}/${scored} (${Math.round((passed / scored) * 100)}%)`);

process.exit(errored === tasks.length ? 2 : passed === scored ? 0 : 1);
