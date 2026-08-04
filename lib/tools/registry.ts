import type { ToolSet } from "ai";
import { buildDevTools } from "@/lib/ai/dev-tools";
import { buildExecutionTools } from "@/lib/ai/execution-tools";
import { buildGitHubWriteTools } from "@/lib/ai/github-write-tools";
import { buildSkillTools } from "@/lib/ai/skill-tools";
import { buildWebTools } from "@/lib/ai/web-tools";
import type { NaviMode, ToolPolicy } from "@/lib/ai/types";

/**
 * One place that decides what NaviSol can do this turn.
 *
 * Before this the answer was assembled inline in the chat route from five
 * separate builders, each with its own idea of when it applied. Nothing could
 * state the whole toolset without reading the route, nothing enforced a ceiling
 * on how many tools went out, and a capability that should have been off in
 * Chat mode was off only because no line of code happened to switch it on.
 *
 * The model sees one flat list. Where a tool runs — here, on the device, or
 * behind an HTTP route — is an implementation detail of that tool, not
 * something the registry or the model needs to know.
 */

/**
 * Past roughly a dozen tools, model tool-selection accuracy falls off and every
 * turn pays the schema cost of the ones it will not call. The cap is enforced
 * rather than advised, because the failure it prevents is silent: more tools
 * still *works*, it just quietly picks worse ones.
 */
export const MAX_ACTIVE_TOOLS = 12;

export type ToolsetContext = {
  /** The product mode. Chat never receives repository write tools. */
  mode: NaviMode;
  /** The user's own switches. A tool the user turned off is not offered. */
  policy: ToolPolicy;
  /** Per-user GitHub token from OAuth, when they have connected an account. */
  githubToken?: string;
  /** Server-side writes are separately gated; see `github-write-tools`. */
  githubWritesEnabled?: boolean;
  signal: AbortSignal;
  /** Reports what is being done, for the activity chips. */
  onActivity?: (label: string) => void;
  /** Tools contributed by connected MCP servers, already namespaced. */
  mcpTools?: ToolSet;
};

/**
 * Ordered by how much a turn loses when the tool is missing.
 *
 * This is the order the cap trims from the end of, so it is not cosmetic: when
 * a user connects enough MCP servers to exceed the ceiling, what survives is
 * decided here. Local capabilities outrank remote ones because a connector is
 * something the user chose to add and can choose to remove, while these are
 * what the app is.
 */
type Group = { name: string; tools: () => ToolSet; when: (context: ToolsetContext) => boolean };

const GROUPS: Group[] = [
  {
    name: "skills",
    // Deterministic, local, no network. Cheapest thing in the list.
    tools: () => buildSkillTools(),
    when: () => true
  },
  {
    name: "execution",
    tools: () => buildExecutionTools(),
    when: ({ policy }) => policy.code
  },
  {
    /* Note the predicate: this group is always on. Reading the clock and
       fetching a page need no configuration and are useful on every turn — it
       is *search* that depends on the user's switch and on a provider key, and
       that distinction lives inside the builder. Gating the whole group on
       `policy.web` would take away exact date arithmetic from anyone who turned
       research off, which is not what that switch means. */
    name: "web",
    tools: () => ({}),
    when: () => true
  },
  {
    name: "repository",
    tools: () => ({}),
    when: ({ mode, githubToken }) => mode === "code" && Boolean(githubToken)
  },
  {
    name: "repository-write",
    /* Writes are Code mode only, and only when the deployment has switched
       them on. Chat mode never receives them, whatever the token allows. */
    tools: () => ({}),
    when: ({ mode, githubToken, githubWritesEnabled }) => mode === "code" && Boolean(githubToken) && Boolean(githubWritesEnabled)
  }
];

/**
 * Trim to the ceiling, keeping the earliest entries.
 *
 * Exported because the trimming decision is worth testing directly: which tools
 * survive a crowded turn is a product decision, and it should not be inferred
 * from the order of a spread.
 */
export function capToolset(tools: ToolSet, max = MAX_ACTIVE_TOOLS): ToolSet {
  const names = Object.keys(tools);
  if (names.length <= max) return tools;
  const kept: ToolSet = {};
  for (const name of names.slice(0, max)) kept[name] = tools[name];
  return kept;
}

/**
 * The tools valid for this mode and this user, as one flat set.
 *
 * Builders that need request-scoped arguments are called here rather than in
 * the table above, because the table describes *when* a group applies and this
 * describes *how* it is constructed — keeping those separate is what lets the
 * `when` predicates be read at a glance.
 */
export function buildToolset(context: ToolsetContext): ToolSet {
  const { policy, mode, githubToken, githubWritesEnabled, signal, onActivity = () => {}, mcpTools = {} } = context;

  const active = (name: string) => GROUPS.find((group) => group.name === name)?.when(context) ?? false;

  const local: ToolSet = {
    ...buildSkillTools(onActivity),
    ...(active("execution") ? buildExecutionTools() : {}),
    ...buildWebTools({ search: policy.web, signal, onActivity }),
    // Repository and deployment reads, present only when their tokens are.
    ...buildDevTools(onActivity, { githubToken }),
    ...(active("repository-write") && githubToken
      ? buildGitHubWriteTools({ token: githubToken, onActivity })
      : {})
  };

  /* MCP last, so a connector can never displace a built-in capability when the
     cap trims. A user who connects ten servers loses connector tools, not the
     ability to run code. */
  return capToolset({ ...local, ...mcpTools });
}

/** Which groups are switched on, for diagnostics and for the settings screen. */
export function activeGroups(context: ToolsetContext): string[] {
  return GROUPS.filter((group) => group.when(context)).map((group) => group.name);
}
