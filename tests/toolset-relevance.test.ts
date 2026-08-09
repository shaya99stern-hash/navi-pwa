import { MAX_ACTIVE_TOOLS, capToolset, wantsAccountTools } from "../lib/tools/registry";
import type { ToolSet } from "ai";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* The failure this guards. Built-in capabilities alone — six skill tools, two
   execution tools, three web tools — fill eleven of twelve slots, leaving one
   for the ten GitHub and Vercel tools. A user with both accounts connected
   asked to list their repositories and was told the app had no access. Nothing
   was broken; the tools had been trimmed off the end before the model saw them. */

const set = (names: string[]): ToolSet =>
  Object.fromEntries(names.map((name) => [name, {} as never])) as ToolSet;

const builtIns = [
  "calculate", "convert_units", "current_datetime", "date_calculate", "transform_data", "inspect_text",
  "run_javascript", "run_python",
  "fetch_url", "web_search", "inspect_text_2"
];
const dev = [
  "github_list_repos", "github_read_file", "github_list_directory", "github_search_code",
  "github_list_pull_requests", "github_check_ci", "github_read_workflow_log",
  "vercel_list_projects", "vercel_list_deployments", "vercel_read_build_log"
];

check("the built-ins leave little room", builtIns.length >= MAX_ACTIVE_TOOLS - 6, true);
const crowded = Object.keys(capToolset(set([...builtIns, ...dev])));
check("the cap is honoured", crowded.length, MAX_ACTIVE_TOOLS);
/* Documenting the starvation rather than asserting it is acceptable: this is
   what happens when everything is offered at once, and it is why the group is
   gated on relevance instead. The raised ceiling widened the gap rather than
   closing it — the account tools still cannot all fit beside the built-ins. */
check("the account tools are still starved when everything is offered", crowded.filter((name) => dev.includes(name)).length < dev.length, true);
check("dropping the account tools leaves room", Object.keys(capToolset(set(builtIns))).length, builtIns.length);

/* ---- When the account tools are offered ------------------------------ */

for (const request of [
  "Can you list me my git hub repos",
  "list my repositories",
  "what's failing in CI",
  "open a pull request for this",
  "which branch is that on",
  "check the latest deployment",
  "What's my vercel account username",
  "show me the build log",
  "is production up"
]) {
  check(`offered for: ${request}`, wantsAccountTools(request), true);
}

/* And not offered when the turn is about something else, or there would be no
   budget left for the capabilities every turn actually uses. */
for (const request of [
  "what is 12% of 4300",
  "write me a haiku about rain",
  "what did she say about Thursday",
  "translate this to Hebrew",
  ""
]) {
  check(`not offered for: ${request || "(empty)"}`, wantsAccountTools(request), false);
}

check("an absent request offers nothing", wantsAccountTools(undefined), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
