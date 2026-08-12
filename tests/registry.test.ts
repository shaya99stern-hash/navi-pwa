import type { ToolSet } from "ai";
import { activeGroups, buildToolset, capToolset, MAX_ACTIVE_CODE_TOOLS, MAX_ACTIVE_TOOLS, toolCeiling, type ToolsetContext } from "@/lib/tools/registry";
import { PROVIDERS, modelsProbe } from "@/lib/ai/provider-registry";

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
   reproduces exactly the bug they fix — Navi Soul insisting it cannot reach
   the repository. Sixteen is still a ceiling, not an invitation. */
check("the chat ceiling is sixteen", MAX_ACTIVE_TOOLS, 16);
check("chat mode gets the chat ceiling", toolCeiling("chat"), MAX_ACTIVE_TOOLS);
check("code mode gets a larger ceiling", toolCeiling("code") > toolCeiling("chat"), true);

/* Past roughly a dozen the model picks worse tools and every turn pays the
   schema cost of the ones it will not call — a failure that is invisible
   because more tools still technically works. */
const everything = ctx({ policy: { web: true, code: true, artifacts: true }, mode: "code", githubToken: "t", githubWritesEnabled: true });
check("a real toolset stays inside its ceiling", names(everything).length <= MAX_ACTIVE_CODE_TOOLS, true);
check("a real chat toolset stays inside the chat ceiling", names(ctx({ policy: { web: true, code: true, artifacts: true }, clerkToken: "t", clerkUserId: "u" })).length <= MAX_ACTIVE_TOOLS, true);

/* One ceiling for both modes silently deleted the point of Code mode. Count
   what it switches on — five skill tools, two execution, three web, three
   self-update, three provisioning — and seventeen slots are gone before a
   single repository tool is reached. The cap trims from the end, so with a
   GitHub account connected `github_read_file` and `github_search_code` were
   cut every turn, and the only symptom was Navi Soul saying it could not reach
   a repository it held the token for. */
const codeTools = names(everything);
check("code mode can read a repository file", codeTools.includes("github_read_file"), true);
check("code mode can search repository code", codeTools.includes("github_search_code"), true);

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

/* ── Knowing what it is running on ───────────────────────────────────────── */

/* Every fabricated answer about NaviOS itself has one shape: asked about
   itself, it reasoned from assumption because nothing let it look. It invented
   a Settings path, invented an environment flag, and announced it had no code
   sandbox while an unconfigured one sat there. So this group is unconditional —
   there is no request shape that reliably predicts "and now I will make
   something up about myself". */
check("self-inspection is always available", names(ctx()).includes("inspect_environment"), true);
check("self-inspection survives every switch being off", names(ctx({ policy: { web: false, code: false, artifacts: false } })).includes("inspect_environment"), true);
check("a key can be tested for real", names(ctx()).includes("test_service"), true);
check("self-inspection is not trimmed by connectors", names(ctx({ mcpTools: crowded })).includes("inspect_environment"), true);

/* ── Learning from its own experience ────────────────────────────────────── */

/* Same gate as `learn_skill`, because it writes to the same store. Offering a
   tool that has nowhere to put what it is given is worse than not offering it:
   the model reports the save, and nothing was saved. */
check("lessons need a signed-in user", names(ctx()).includes("record_lesson"), false);
check("lessons need a user id, not just a token", names(ctx({ clerkToken: "t" })).includes("record_lesson"), false);
check("reflection is gated with learning", activeGroups(ctx({ clerkToken: "t", clerkUserId: "u" })).includes("reflection"), true);
check("reflection is off when learning is", activeGroups(ctx()).includes("reflection"), false);

/* ── The list is flat and well formed ────────────────────────────────────── */

const full = buildToolset(ctx({ policy: { web: true, code: true, artifacts: true }, mode: "code", githubToken: "t" }));
check("every entry has a description", Object.values(full).every((tool) => typeof (tool as { description?: unknown }).description === "string"), true);
check("every entry has an input schema", Object.values(full).every((tool) => Boolean((tool as { inputSchema?: unknown }).inputSchema)), true);
check("no tool name is empty", Object.keys(full).every((name) => name.trim().length > 0), true);
/* Tool names reach the model and the activity chips. A provider name in one
   would leak through both. */
check("no tool name names a provider", Object.keys(full).some((name) => /gemini|groq|cerebras|openrouter|mistral|deepseek|tavily/i.test(name)), false);

/* ── How each provider wants to be asked for its models ──────────────────────
   Gemini's chat endpoint is OpenAI-compatible and its model listing is not.
   Pointing the listing at `/v1beta/openai/models` answered 404 for every key
   ever tried, and Connectors reported that verbatim — so a working key read as
   a broken service. The probe is built in one place now; these pin it. */

check("Gemini lists models from Google's own path", PROVIDERS.gemini.modelsUrl, "https://generativelanguage.googleapis.com/v1beta/models");
check("and not the OpenAI-compatible one", /openai\/models/.test(PROVIDERS.gemini.modelsUrl), false);
check("its chat base stays OpenAI-compatible", PROVIDERS.gemini.baseURL, "https://generativelanguage.googleapis.com/v1beta/openai/");

const geminiProbe = modelsProbe(PROVIDERS.gemini, "AIzaTESTKEY");
check("Gemini authenticates with Google's header", geminiProbe.headers["x-goog-api-key"], "AIzaTESTKEY");
check("and not with a bearer token", geminiProbe.headers.Authorization, undefined);
/* A key in a query string ends up in proxy logs and in any error that quotes
   the URL, so no provider may put one there. */
check("no provider puts its key in the URL", Object.values(PROVIDERS).some((adapter) => modelsProbe(adapter, "SECRET").url.includes("SECRET")), false);

const groqProbe = modelsProbe(PROVIDERS.groq, "gsk_TESTKEY");
check("every other provider still uses a bearer token", groqProbe.headers.Authorization, "Bearer gsk_TESTKEY");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
