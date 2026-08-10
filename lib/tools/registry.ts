import type { ToolSet } from "ai";
import { buildDevTools } from "@/lib/ai/dev-tools";
import { buildExecutionTools } from "@/lib/ai/execution-tools";
import { buildGitHubWriteTools } from "@/lib/ai/github-write-tools";
import { buildGoogleTools } from "@/lib/ai/google-tools";
import { buildConnectorTools, buildProvisioningTools } from "@/lib/ai/connector-tools";
import { buildEnvironmentTools } from "@/lib/ai/environment-tools";
import { buildLearningTools } from "@/lib/ai/learning-tools";
import { buildReflectionTools } from "@/lib/ai/reflection-tools";
import { buildSelfUpdateTools, selfUpdateToken } from "@/lib/ai/self-update-tools";
import { buildSkillTools } from "@/lib/ai/skill-tools";
import { buildWebTools } from "@/lib/ai/web-tools";
import type { CustomConnector, NaviMode, ToolPolicy } from "@/lib/ai/types";

/**
 * One place that decides what NaviSoul can do this turn.
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
 *
 * One number for both modes was wrong, and wrong in a way nothing surfaced.
 * Count what Code mode actually switches on: five skill tools, two execution,
 * three web, three self-update, three provisioning — seventeen before a single
 * repository tool is reached. The cap trims from the end, so with a GitHub
 * account connected every one of `github_read_file`, `github_search_code` and
 * `github_check_ci` was cut before the model saw it. Code mode had the
 * repository tools it is *for* removed on every turn, and the only symptom was
 * NaviSoul saying it could not reach the repository while holding the token.
 *
 * So the ceiling is per mode. Chat keeps the tighter budget, because a chat
 * turn genuinely does not need twenty tools and selection accuracy is the whole
 * point. Code gets the room its surface actually requires.
 */
export const MAX_ACTIVE_TOOLS = 16;
export const MAX_ACTIVE_CODE_TOOLS = 22;

/** The ceiling that applies to a mode. */
export function toolCeiling(mode: NaviMode): number {
  return mode === "code" ? MAX_ACTIVE_CODE_TOOLS : MAX_ACTIVE_TOOLS;
}

export type ToolsetContext = {
  /** The product mode. Chat never receives repository write tools. */
  mode: NaviMode;
  /** The user's own switches. A tool the user turned off is not offered. */
  policy: ToolPolicy;
  /** Per-user GitHub token from OAuth, when they have connected an account. */
  githubToken?: string;
  /** A live Google access token, when they have connected that account. */
  googleAccessToken?: string;
  /** The user's last message, so a group can be offered when it is wanted. */
  request?: string;
  /** Server-side writes are separately gated; see `github-write-tools`. */
  githubWritesEnabled?: boolean;
  /** The caller's Clerk session, which is what learned-skill storage keys on. */
  clerkToken?: string;
  clerkUserId?: string;
  signal: AbortSignal;
  /** This deployment's own origin, so a tool can reach a sibling route. */
  origin?: string;
  /** The caller's cookies, forwarded so a sibling route sees the same user. */
  cookie?: string;
  /** Reports what is being done, for the activity chips. */
  onActivity?: (label: string) => void;
  /** Tools contributed by connected MCP servers, already namespaced. */
  mcpTools?: ToolSet;
  /** Connectors the user added from the Connectors screen on this device. */
  customConnectors?: CustomConnector[];
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
    /* Knowing what it is running on. Always on, and high in the order, because
       this is the group that stops NaviSoul answering questions about itself
       from assumption — it invented a Settings path, invented an environment
       flag, and announced it had no code sandbox while one sat there
       unconfigured. Every one of those is a turn where nothing let it look.
       Two schemas on every turn is the price of not fabricating, which is
       cheap. */
    name: "environment",
    tools: () => ({}),
    when: () => true
  },
  {
    /* Permanent learning. Only when signed in and storage is configured, so
       the model is never offered a promise it cannot keep. */
    name: "learning",
    tools: () => ({}),
    when: ({ clerkToken, clerkUserId }) => Boolean(clerkToken && clerkUserId)
  },
  {
    /* Learning from its own experience rather than only from instruction. Same
       gate as `learning` because it writes to the same store: without a signed-in
       user there is nowhere to put a lesson, and a tool that silently discards
       what it was given is worse than one that is absent. */
    name: "reflection",
    tools: () => ({}),
    when: ({ clerkToken, clerkUserId }) => Boolean(clerkToken && clerkUserId)
  },
  {
    /* Editing NaviOS itself. Code mode only, and only when the deployment
       carries the token that exists for exactly this purpose. */
    name: "self-update",
    tools: () => ({}),
    when: ({ mode, request }) => Boolean(selfUpdateToken()) && (mode === "code" || wantsSelfUpdate(request))
  },
  {
    /* Repository and deployment reads. In both modes — "which of my repos has
       failing CI" is not a Code-mode question — but only when the request is
       about them, because ten tools cannot sit in a twelve-slot budget on
       every turn without displacing everything else.

       Ahead of the connector groups deliberately. Both used to sit above it and
       both are three tools wide, which is six slots of *adding a service* taken
       from *reading the code* on precisely the turns where the code is the
       subject. Connecting something is a thing the user asks for by name, so it
       survives on the turns it is wanted; reading the repository is the
       background work of every Code-mode answer. */
    name: "repository",
    tools: () => ({}),
    when: ({ mode, githubToken, request }) => Boolean(githubToken) && (mode === "code" || wantsAccountTools(request))
  },
  {
    name: "repository-write",
    /* Writes are Code mode only, and only when the deployment has switched
       them on. Chat mode never receives them, whatever the token allows.

       Kept next to the reads it depends on: opening a pull request against a
       file you were never able to read is not a capability, it is a way to
       write the wrong patch. Either both survive the cap or neither is much
       use. */
    tools: () => ({}),
    when: ({ mode, githubToken, githubWritesEnabled }) => mode === "code" && Boolean(githubToken) && Boolean(githubWritesEnabled)
  },
  {
    /* Connecting NaviOS to a service by name, and writing the key into its own
       configuration. Offered when the turn is about connecting something, or
       in Code mode where configuration is the subject anyway. */
    name: "provisioning",
    tools: () => ({}),
    when: ({ mode, request }) => mode === "code" || wantsProvisioning(request)
  },
  {
    /* The connectors the user typed in themselves. One tool for all of them. */
    name: "custom-connectors",
    tools: () => ({}),
    when: ({ customConnectors }) => Boolean(customConnectors?.some((connector) => connector.kind !== "mcp"))
  },
  {
    /* Mail and calendar, in both modes. Unlike repositories these are not a
       developer capability — "what did she say about Thursday" is an ordinary
       question, and putting it behind Code mode would make the connector
       useless to the person most likely to want it. Which of these tools exist
       is decided inside the builder by what the grant actually covers. */
    name: "google",
    tools: () => ({}),
    when: ({ googleAccessToken }) => Boolean(googleAccessToken)
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
 * Does this request plausibly concern a connected account?
 *
 * The cap trims from the end, and the built-in capabilities alone — six skill
 * tools, two execution tools, three web tools — fill eleven of twelve slots.
 * That left exactly one for the ten GitHub and Vercel tools, so a user with
 * both accounts connected asked to list their repositories and was told the
 * app had no access to them. Nothing was broken; the tools had simply been
 * trimmed off the end before the model ever saw them.
 *
 * Offering them on every turn is not the answer either — that is what the cap
 * exists to prevent. So they are offered when the request is about them, which
 * is also the only time they are worth their schema cost.
 *
 * Deliberately generous, for the same reason `needsAppKnowledge` is: a false
 * positive costs a few hundred tokens on one turn, a false negative tells
 * someone their connected account is not connected.
 */
const MENTIONS_REPOSITORY = /\b(repo|repos|repositor\w*|github|git|pull request|pr|commit|branch|merge|ci|workflow|action|build log|codebase|source code)\b/i;
const MENTIONS_DEPLOYMENT = /\b(vercel|deploy\w*|build|preview|production|hosting|domain)\b/i;

export function wantsAccountTools(request: string | undefined): boolean {
  if (!request) return false;
  return MENTIONS_REPOSITORY.test(request) || MENTIONS_DEPLOYMENT.test(request);
}

/**
 * Is this turn about changing NaviOS itself?
 *
 * Chat mode gets these too when the request is plainly about the app, because
 * "add a button to the composer" is not a Code-mode-only sentence and being
 * told to switch modes first is not an answer.
 */
const MENTIONS_SELF_UPDATE = /\b(your own code|your code|this app|the app|navios|navi-pwa|self.?update|edit yourself|your source|your repo|commit|deploy)\b/i;

/**
 * Is this turn about connecting NaviOS to something?
 *
 * Generous on purpose, like its siblings: a false positive costs two tool
 * schemas on one turn, a false negative sends someone to the Vercel dashboard
 * on a phone to do by hand what the app can do for them.
 */
const MENTIONS_PROVISIONING = /\b(connect|connector|api key|apikey|token|add (?:a |an |my )?(?:key|api|provider|model|service)|hook (?:it |this )?up|set up|configure|integrat\w+|groq|gemini|tavily|exa|openrouter|together|cerebras|sambanova|nvidia|mistral|supabase|hugging\s?face|anthropic|openai)\b/i;

export function wantsProvisioning(request: string | undefined): boolean {
  return Boolean(request) && MENTIONS_PROVISIONING.test(request as string);
}

export function wantsSelfUpdate(request: string | undefined): boolean {
  return Boolean(request) && MENTIONS_SELF_UPDATE.test(request as string);
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
  const { policy, mode, githubToken, googleAccessToken, githubWritesEnabled, clerkToken, clerkUserId, customConnectors = [], signal, origin, cookie, onActivity = () => {}, mcpTools = {} } = context;

  const active = (name: string) => GROUPS.find((group) => group.name === name)?.when(context) ?? false;

  const local: ToolSet = {
    ...buildSkillTools(onActivity),
    ...(active("execution") ? buildExecutionTools({ origin, cookie }) : {}),
    ...buildWebTools({ search: policy.web, signal, onActivity }),
    ...buildEnvironmentTools({ onActivity }),
    ...(active("learning") ? buildLearningTools({ clerkToken, clerkUserId, onActivity }) : {}),
    ...(active("reflection") ? buildReflectionTools({ clerkToken, clerkUserId, onActivity }) : {}),
    ...(active("self-update") ? buildSelfUpdateTools({ signal, onActivity }) : {}),
    // Repository and deployment reads, present only when their tokens are —
    // and only when this turn is plausibly about them; see `wantsAccountTools`.
    ...(active("repository") || mode === "code" ? buildDevTools(onActivity, { githubToken }) : {}),
    ...(active("repository-write") && githubToken
      ? buildGitHubWriteTools({ token: githubToken, onActivity })
      : {}),
    ...(active("provisioning") ? buildProvisioningTools({ origin, cookie, onActivity }) : {}),
    ...(active("custom-connectors") ? buildConnectorTools({ connectors: customConnectors, signal, onActivity }) : {}),
    ...(active("google") ? buildGoogleTools(onActivity, { accessToken: googleAccessToken }) : {})
  };

  /* MCP last, so a connector can never displace a built-in capability when the
     cap trims. A user who connects ten servers loses connector tools, not the
     ability to run code. */
  return capToolset({ ...local, ...mcpTools }, toolCeiling(mode));
}

/** Which groups are switched on, for diagnostics and for the settings screen. */
export function activeGroups(context: ToolsetContext): string[] {
  return GROUPS.filter((group) => group.when(context)).map((group) => group.name);
}
