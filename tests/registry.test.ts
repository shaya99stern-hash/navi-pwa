import type { ToolSet } from "ai";
import { activeGroups, buildToolset, capToolset, MAX_ACTIVE_TOOLS, type ToolsetContext } from "@/lib/tools/registry";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const base: ToolsetContext = {
  mode: "chat",
  policy: { web: false, code: false, artifacts: true },
  signal: new AbortController().signal
};

const ctx = (patch: Partial<ToolsetContext> = {}): ToolsetContext => ({ ...base, ...patch });
const names = (context: ToolsetContext) => Object.keys(buildToolset(context));

/* ── The cap is enforced, not advised ────────────────────────────────────── */

const many: ToolSet = {};
for (let index = 0; index < 30; index += 1) many[`tool_${index}`] = {} as never;

check("a crowded toolset is trimmed", Object.keys(capToolset(many)).length, MAX_ACTIVE_TOOLS);
check("a small toolset is untouched", Object.keys(capToolset({ a: {} as never, b: {} as never })).length, 2);
check("trimming keeps the earliest entries", Object.keys(capToolset(many, 3)), ["tool_0", "tool_1", "tool_2"]);
/* Raised from twelve when self-editing landed: read, list, and commit are
   three tools that must coexist with the built-ins, and starving them
   reproduces exactly the bug they fix — NaviSoul insisting it cannot reach
   the repository. Sixteen is still a ceiling, not an invitation. */
check("the ceiling is sixteen", MAX_ACTIVE_TOOLS, 16);

/* Past roughly a dozen the model picks worse tools and every turn pays the
   schema cost of the ones it will not call — a failure that is invisible
   because more tools still technically works. */
check("a real toolset stays inside the ceiling", names(ctx({ policy: { web: true, code: true, artifacts: true }, mode: "code", githubToken: "t", githubWritesEnabled: true })).length <= MAX_ACTIVE_TOOLS, true);

/* A connector must never displace a built-in capability. Someone who connects
   ten servers should lose connector tools, not the ability to run code. */
const crowded: ToolSet = {};
for (let index = 0; index < 20; index += 1) crowded[`mcp__server__tool_${index}`] = {} as never;
const withMcp = names(ctx({ policy: { web: false, code: true, artifacts: true }, mcpTools: crowded }));
check("connectors do not displace local tools", withMcp.includes("run_javascript"), true);
check("connectors are what gets trimmed", withMcp.filter((name) => name.startsWith("mcp__")).length < 20, true);

/* ── Mode and policy gating ──────────────────────────────────────────────── */

check("code execution is off when the user switched it off", names(ctx()).includes("run_javascript"), false);
check("code execution is on when the user switched it on", names(ctx({ policy: { web: false, code: true, artifacts: true } })).includes("run_javascript"), true);

/* Chat mode never receives repository write tools, whatever the token allows
   and whatever the deployment has enabled. */
const chatWithEverything = names(ctx({ mode: "chat", githubToken: "t", githubWritesEnabled: true }));
check("chat mode gets no branch tool", chatWithEverything.some((name) => /create_branch/.test(name)), false);
check("chat mode gets no commit tool", chatWithEverything.some((name) => /commit|push_files/.test(name)), false);
check("chat mode gets no pull request tool", chatWithEverything.some((name) => /create_pull_request/.test(name)), false);

check("writes need code mode", activeGroups(ctx({ mode: "chat", githubToken: "t", githubWritesEnabled: true })).includes("repository-write"), false);
check("writes need a token", activeGroups(ctx({ mode: "code", githubWritesEnabled: true })).includes("repository-write"), false);
check("writes need the deployment switch", activeGroups(ctx({ mode: "code", githubToken: "t" })).includes("repository-write"), false);
check("writes need all three", activeGroups(ctx({ mode: "code", githubToken: "t", githubWritesEnabled: true })).includes("repository-write"), true);

/* Reading the clock and fetching a page need no configuration. Gating them on
   the research switch would take exact date arithmetic away from anyone who
   turned research off, which is not what that switch means. */
check("the clock survives research being off", names(ctx({ policy: { web: false, code: false, artifacts: true } })).some((name) => /time|date|clock/i.test(name)), true);

/* ── The list is flat and well formed ────────────────────────────────────── */

const full = buildToolset(ctx({ policy: { web: true, code: true, artifacts: true }, mode: "code", githubToken: "t" }));
check("every entry has a description", Object.values(full).every((tool) => typeof (tool as { description?: unknown }).description === "string"), true);
check("every entry has an input schema", Object.values(full).every((tool) => Boolean((tool as { inputSchema?: unknown }).inputSchema)), true);
check("no tool name is empty", Object.keys(full).every((name) => name.trim().length > 0), true);
/* Tool names reach the model and the activity chips. A provider name in one
   would leak through both. */
check("no tool name names a provider", Object.keys(full).some((name) => /gemini|groq|cerebras|openrouter|mistral|deepseek|tavily/i.test(name)), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
