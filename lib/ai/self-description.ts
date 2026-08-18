import { EFFORT_LEVELS, NAVI_MODES } from "../chat";
import { CONNECTOR_KINDS } from "./types";
import { PROVIDER_CATALOG } from "./provider-catalog";
import { credentialAdvice } from "./credentials";

/**
 * The parts of "what am I" that the code can state about itself.
 *
 * `APP_KNOWLEDGE` is prose someone wrote about this app, and prose about a
 * moving app is prose that goes stale. It has, twice that were findable by
 * reading it: it documented a Settings section that had been deleted, and it
 * named `NAVI_GITHUB_TOKEN` as the variable for repository access while four
 * modules disagreed about which variable that actually was. Both are the same
 * defect — a static claim standing in for a fact the code already holds — and
 * both reach the user as an assistant that is confidently wrong about itself.
 *
 * So the rule for this module: **if the app holds the value, render the value.**
 * Nothing here is typed out that a live object already knows.
 *
 * ## What is deliberately not here
 *
 * *Which credentials are actually set.* That is `inspect_environment`'s job,
 * and it is a runtime fact rather than a structural one — putting it in the
 * prompt would freeze it at the moment the prompt was built and make the
 * answer stale by the time it is read. This block says which variable governs
 * which capability; the tool says which of them are filled in.
 *
 * *The per-turn tool list.* The prompt already names the tools this turn holds,
 * and it names them from the toolset rather than from a description of it.
 * Repeating them here would add a second source that could disagree.
 */

/**
 * Every route this app serves, and what is behind it.
 *
 * Declared rather than derived because the edge runtime cannot read the
 * filesystem — but guarded by a test that *can*, so a page added or deleted
 * without touching this list fails CI instead of becoming a confidently wrong
 * answer about a screen that is not there. That is the whole reason the
 * deleted Developer section survived in the prompt for as long as it did.
 */
export const ROUTES: ReadonlyArray<{ path: string; what: string }> = [
  { path: "/", what: "new chat, with the time-of-day greeting" },
  { path: "/new", what: "new chat; also receives text shared from the OS share sheet" },
  { path: "/chat/[id]", what: "one conversation" },
  { path: "/recents", what: "every saved chat, searchable" },
  { path: "/projects", what: "projects: a name, reusable instructions, and knowledge items added to context" },
  { path: "/artifacts", what: "interactive artifacts produced in chats" },
  { path: "/connectors", what: "accounts, registry MCP servers, and the user's own added connectors" },
  { path: "/customize", what: "response style and tool toggles" },
  { path: "/settings", what: "theme, motion, haptics, history, voice language, data export" },
  { path: "/voice", what: "starts a spoken conversation straight away" },
  { path: "/offline", what: "shown when a route is unavailable offline" },
  { path: "/access-denied", what: "shown to an account that is not allowed into this deployment" },
  { path: "/sign-in/[[...sign-in]]", what: "Clerk sign-in, when Clerk is configured" },
  { path: "/sign-up/[[...sign-up]]", what: "Clerk sign-up, when Clerk is configured" }
];

/** The facts, rendered from the objects that hold them. */
export function derivedAppFacts(): string {
  const byKind = (kind: string) => PROVIDER_CATALOG.filter((entry) => entry.kind === kind);

  return [
    "## What this app is made of",
    "",
    "Everything below is read from the app's own configuration at the moment this request was built, not from a description of it. State it as fact. What it does *not* say is which credentials are actually filled in — call `inspect_environment` for that, and never guess it from this list.",
    "",
    "### Screens",
    ...ROUTES.map((route) => `- \`${route.path}\` — ${route.what}`),
    "",
    "### The controls in the composer, and what each one is called",
    /* Read from the same constants the composer renders, because the prose that
       used to carry this had drifted: it named the effort levels "Standard,
       Extended, Maximum" long after they became Quick, Considered and Deep. So
       the owner asked what had happened to the three levels of thinking they
       used to switch between — the ones still sitting in the composer — and the
       app, reading its own description, could not recognise the names of its
       own controls. A list written by hand is a list that goes stale; this one
       cannot. */
    `- Effort, a pill in the composer with three levels: ${EFFORT_LEVELS.map((level) => `**${level.label}** (${level.detail}${level.isDefault ? " The default." : ""})`).join(" ")}`,
    `- Mode, a toggle in the composer: ${NAVI_MODES.map((mode) => `**${mode.label}**`).join(" and ")}. Chat is the default and is simply Code switched off.`,
    "- Research, a toggle in the composer, which allows web search when a search key is configured.",
    "- Voice, which starts a spoken conversation: it listens, answers aloud, and reopens the microphone. It can be interrupted by talking over it.",
    "State these by the names above. If the user names a control you cannot find here, say so plainly rather than denying the control exists.",
    "",
    "### Which variable governs which capability",
    "Name the exact variable when something is missing. These are the only names read, and every one listed for a capability works — do not send someone to add a second variable for something they have already configured.",
    `- Answers at all: any model provider key. ${byKind("model").map((entry) => `\`${entry.envKey}\` (${entry.label})`).join(", ")}.`,
    `- Web search: ${byKind("search").map((entry) => `\`${entry.envKey}\``).join(" or ")}. Reading a page with \`fetch_url\` needs no key at all and is available whenever that tool is present.`,
    "- Images, sound, and voice transcription: `HF_TOKEN`. Transcription also uses `GROQ_API_KEY` when set, which is the faster path.",
    `- Cloud memory across devices: ${byKind("database").map((entry) => `\`${entry.envKey}\``).join(" and ")}, plus a signed-in account.`,
    `- Reading repositories and deployments: ${credentialAdvice("github")}, and \`${credentialAdvice("vercel")}\` for Vercel.`,
    "- Committing to this app's own source: `GITHUB_PAT` or `NAVI_GITHUB_TOKEN`. `GITHUB_TOKEN` and `GH_TOKEN` are read for repository *reads* but deliberately not for commits, because build platforms set those two automatically and a token nobody chose to give is not permission to change the app.",
    "- Writes to other repositories additionally need `NAVI_GITHUB_ALLOW_WRITES`.",
    /* Every one of these named, because the gap was filled by invention. Asked
       how to choose the voice, the model produced `ELEVEN_LABS_VOICE_ID` and
       `ENABLE_ELEVEN_LABS_TTS` — neither exists, and following that advice
       changes nothing at all. A variable this app reads and never names is a
       variable somebody will be sent to guess at. */
    "- The premium speech voice: `ELEVENLABS_API_KEY` **and** `NAVI_TTS_VOICE_ID`, both required — the key buys the audio, the voice id says which voice. `NAVI_TTS_MODEL` and `NAVI_TTS_MONTHLY_CHARS` are optional, as are `NAVI_TTS_STABILITY`, `NAVI_TTS_SIMILARITY`, `NAVI_TTS_STYLE` and `NAVI_TTS_SPEAKER_BOOST`. There is no switch that turns the premium voice on or off — it is used whenever both required variables are set. Without them the device's own voice is used, which is a working configuration and not a fault.",
    "- The premium voice speaks *every* spoken reply, not a subset. There is no separate 'chat voice' and no reading-aloud-only mode: one ladder answers everything aloud, premium first and the device's own voice when premium cannot run. Never describe them as different features or offer to switch between them.",
    "",
    "### What the user can connect themselves",
    "On `/connectors`, added from the phone, with a live connection test. The key is stored on the device and sent with the request; it is never held on the server.",
    ...CONNECTOR_KINDS.map((kind) => `- **${kind.label}** — ${kind.purpose}${kind.needsModel ? "; carries a default model name" : ""}.`),
    "",
    "Registry MCP servers are configured in the deployment rather than added here, and their own tool lists become callable tools. Tools that write require the user's explicit approval before they can be called."
  ].join("\n");
}
