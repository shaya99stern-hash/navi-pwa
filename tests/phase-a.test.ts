import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAT_BODY,
  CODE_BODY,
  estimateTokens,
  needsAppKnowledge,
  PROMPT_BASE,
  PROMPT_TOKEN_BUDGET,
  stablePrefix
} from "@/lib/ai/prompt/base";
import { summarise, toolActivity, verbsFor } from "@/app/components/tool-activity";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── A1. Response discipline ─────────────────────────────────────────────── */

/* The old prompt spent roughly 3,000 tokens per turn, 1,773 of them describing
   the app to someone who had not asked about the app. On a phone that is
   latency the user feels on every single message. */
for (const mode of ["chat", "code"] as const) {
  check(`the ${mode} prompt is inside budget`, estimateTokens(stablePrefix(mode)) < PROMPT_TOKEN_BUDGET, true);
}

/* Composition, not branching: one prompt with `if mode ===` inside it makes
   every turn carry the instructions for the mode it is not in, and lets the two
   drift as each is edited around the other. */
check("chat and code bodies differ", CHAT_BODY === CODE_BODY, false);
check("both share the same base", stablePrefix("chat").startsWith(PROMPT_BASE) && stablePrefix("code").startsWith(PROMPT_BASE), true);
check("the base carries no mode conditional", /if\s*\(|mode ===/.test(PROMPT_BASE), false);
check("code mode reaches the code body", stablePrefix("code").includes(CODE_BODY), true);
check("chat mode does not carry the code body", stablePrefix("chat").includes(CODE_BODY), false);

// Every hedge the spec names must be banned by name, or the rule is decorative.
for (const hedge of ["I think", "I believe", "it seems", "you know", "essentially", "it's important to note"]) {
  check(`"${hedge}" is banned by name`, PROMPT_BASE.includes(hedge), true);
}
check("preamble is banned", /Lead with the answer/.test(PROMPT_BASE), true);
check("length is separated from effort", /Length is not thoroughness/.test(PROMPT_BASE), true);
check("code blocks must carry a language", /language tag/.test(PROMPT_BASE), true);
check("provider names are forbidden in the prompt itself", /gemini|groq|cerebras|openrouter|mistral|deepseek|hugging/i.test(PROMPT_BASE), false);

/* The app description loads for questions about the app and stays out of the
   way otherwise. Deliberately generous: a false positive costs tokens once, a
   false negative invents an answer about the product in the user's hand. */
for (const asked of [
  "how do I turn on incognito?",
  "what can you do?",
  "the composer isn't showing my attachments",
  "where is the effort setting",
  "which env var do I need for search?",
  "is NaviOS storing my chats on a server?",
  "voice mode won't open"
]) {
  check(`app knowledge loads for: ${asked}`, needsAppKnowledge(asked), true);
}

for (const ordinary of [
  "write a haiku about rain",
  "what is the capital of Peru",
  "refactor this loop to use map",
  "explain the Monty Hall problem"
]) {
  check(`app knowledge stays out of: ${ordinary}`, needsAppKnowledge(ordinary), false);
}

/* ── A4. Tool activity reads as English ──────────────────────────────────── */

check("search has a present tense", verbsFor("web_search").running, "Searching the web");
check("search has a past tense", verbsFor("web_search").done, "Searched the web");
check("code execution is named plainly", verbsFor("run_javascript").running, "Running code");
check("repository reads are named plainly", verbsFor("github_read_file").running, "Reading the repository");
check("an unknown tool still gets a verb", Boolean(verbsFor("something_new").running), true);
check("no verb names a provider", /gemini|groq|tavily|openrouter|github api/i.test(Object.values(verbsFor("web_search")).join(" ")), false);

check("sources are counted, not quoted", summarise({
  id: "1", name: "web_search", input: {}, state: "done",
  output: "See https://a.example/x and https://b.example/y and https://a.example/x"
}), "2 sources");
check("a running call has no summary yet", summarise({ id: "1", name: "web_search", input: {}, state: "running", output: "" }), "");
check("a failed call has no summary", summarise({ id: "1", name: "web_search", input: {}, state: "failed", output: "boom" }), "");

/* Reading activity off a message: running, done, and failed must be told
   apart, because a failed call is shown as a neutral chip rather than an error
   and the model carries on without it. */
const message = {
  id: "m1",
  role: "assistant" as const,
  parts: [
    { type: "text", text: "answer" },
    { type: "tool-web_search", toolCallId: "a", input: { query: "next.js releases" }, output: "https://one.example" },
    { type: "tool-web_fetch", toolCallId: "b", input: { url: "https://two.example" } },
    { type: "tool-github_read_file", toolCallId: "c", input: { path: "src/x.ts" }, errorText: "404" }
  ]
} as never;

const activities = toolActivity(message);
check("text parts are not activity", activities.length, 3);
check("a completed call reads as done", activities[0].state, "done");
check("a call with no output yet is running", activities[1].state, "running");
check("an errored call reads as failed", activities[2].state, "failed");
check("the tool name loses its part prefix", activities[0].name, "web_search");
check("the input survives for the expanded view", activities[0].input.query, "next.js releases");

/* ── A2 + copy rule, checked against the source ──────────────────────────── */

const root = process.cwd();
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const shell = readFileSync(join(root, "app/components/app-shell.tsx"), "utf8");

/* Failover happens before the first token. Once streaming has begun a lane is
   never swapped, because that would replay a partial answer over one the user
   is already reading. */
check("the commit boundary is still enforced", route.includes("readUntilCommitted"), true);
check("the lane loop still has alternates", route.includes("fallbackRoutes({ primary: route"), true);

// One error state per failure — not a card and a status line for the same event.
check("the error path clears the status line", shell.includes("setStreamStatus(null)"), true);
check("the failure offers a retry", shell.includes("Tap to retry"), true);

/* ── The copy rule: `Navi` alone must not appear in the UI ───────────────── */

const UI_FILES = [
  "app/components/tool-activity.tsx",
  "app/components/execution-trace.tsx",
  "app/components/app-shell.tsx",
  "app/components/message-row.tsx",
  "lib/ai/prompt/base.ts"
];

/* Matches a bare `Navi` not followed by the letters that make it NaviOS or
   NaviSol, and not part of an identifier like `naviMarkdown`. Comments are
   stripped first — this rule is about what a user reads. */
const BARE_NAVI = /\bNavi(?![A-Za-z])/;

for (const file of UI_FILES) {
  const source = readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
  check(`${file} says NaviSol or NaviOS, never bare Navi`, BARE_NAVI.test(source), false);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
