import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROUTES, derivedAppFacts } from "@/lib/ai/self-description";
import { CONNECTOR_KINDS } from "@/lib/ai/types";
import { credentialNames } from "@/lib/ai/credentials";
import { EFFORT_LEVELS, NAVI_MODES } from "@/lib/chat";

let pass = 0;
let fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const root = process.cwd();
const appDir = join(root, "app");

function pageRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_") || entry.startsWith("@")) continue;
      found.push(...pageRoutes(full));
      continue;
    }
    if (entry !== "page.tsx" && entry !== "page.ts") continue;
    const segments = relative(appDir, dir).split(sep).filter((part) => part && !/^\(.+\)$/.test(part));
    found.push(`/${segments.join("/")}`.replace(/\/$/, "") || "/");
  }
  return found;
}

const actualRoutes = pageRoutes(appDir).sort();
const documentedRoutes = ROUTES.map((route) => route.path).sort();
check("every served screen is documented", actualRoutes.filter((path) => !documentedRoutes.includes(path)), []);
check("nothing is documented that does not exist", documentedRoutes.filter((path) => !actualRoutes.includes(path)), []);
check("no screen is listed twice", documentedRoutes.length, new Set(documentedRoutes).size);
check("every screen says what it is for", ROUTES.every((route) => route.what.trim().length > 8), true);

const facts = derivedAppFacts();
for (const name of credentialNames("github")) check(`the ${name} variable is named`, facts.includes(name), true);
check("commit credentials explain the narrower set", /build platforms set those two automatically/.test(facts), true);
for (const kind of CONNECTOR_KINDS) {
  check(`${kind.label} is offered`, facts.includes(kind.label), true);
  check(`${kind.label} says what it is for`, facts.includes(kind.purpose), true);
}
check("every screen reaches rendered facts", ROUTES.every((route) => facts.includes(route.path)), true);
check("runtime configuration is inspected instead of guessed", /call `inspect_environment` for that/.test(facts), true);
check("the static description says not to guess runtime state", /never guess it from this list/.test(facts), true);

const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const knowledge = readFileSync(join(root, "lib/ai/app-knowledge.ts"), "utf8");
check("derived facts reach the prompt", /derivedAppFacts\(\)/.test(route), true);
check("derived facts share the app-knowledge condition", /needsAppKnowledge\(request\) \? derivedAppFacts\(\) : ""/.test(route), true);
check("deleted Developer route is absent from prose", /settings\/Developer/.test(knowledge), false);
check("screen list is not duplicated in prose", /`\/recents` — all saved chats/.test(knowledge), false);
check("connector kinds are not duplicated in prose", /OpenAI-compatible, Anthropic-\s*\n?\s*compatible, Supabase, MCP over HTTPS/.test(knowledge), false);
check("credential names are not duplicated in prose", /NAVI_GITHUB_TOKEN/.test(knowledge), false);

check("owner configuration questions are treated as their property", /every question about it — what is set, what is failing, which variable governs what, why a capability is off — is a question about their own property/.test(route), true);
check("owner configuration answers come from diagnostic tools", /from `inspect_environment` and the other diagnostic tools rather than from memory/.test(route), true);
check("owner configuration is not hedged as someone else's", /never hedge as though the setup belonged to someone else/.test(route), true);
check("credential values remain secret", /Do not print one, because a secret repeated into a conversation is in every copy of that conversation afterwards/.test(route), true);
check("safe credential status is offered instead", /Name the variable, say whether it is set, say what it enables/.test(route), true);
check("owner product authority remains explicit", /Their decisions about how NaviOS should look, behave, and be built are final/.test(route), true);
check("authority does not outrank accuracy", /This settles authority, not accuracy/.test(route), true);
check("owner-only guidance stays owner-only", /if \(!isOwner\) return "";/.test(route), true);

const controls = derivedAppFacts();
for (const level of EFFORT_LEVELS) check(`${level.label} effort level is derived from the constant`, controls.includes(level.label), true);
check("default effort is identified", /\*\*Considered\*\*[^\n]*The default\./.test(controls), true);
check("all Navi modes are derived from constants", NAVI_MODES.every((mode) => controls.includes(mode.label)), true);
const knowledgeCode = knowledge.replace(/\/\*[\s\S]*?\*\//g, "");
check("invented effort labels are gone", /Standard, Extended, Maximum/.test(knowledgeCode), false);
check("prose defers control names to derived facts", /never name them from memory/.test(knowledgeCode), true);
check("unknown controls are not denied without checking", controls.includes("say so plainly rather than denying the control exists"), true);
check("voice interruption is described", controls.includes("interrupted by talking over it"), true);

const settings = readFileSync(join(root, "app/components/settings-sheet.tsx"), "utf8");
check("self-update branch is read from the constant", settings.includes("Defaults to ${DEFAULT_SELF_UPDATE_BRANCH}"), true);
check("the obsolete main-default claim stays gone", /Defaults to main\./.test(settings), false);
/* Compact settings no longer explains the whole deployment flow inline. The
   important regression boundary is that it must not claim a self-edit goes
   live automatically; the full pull-request behavior remains in the derived
   app description and self-update tools. */
check("settings does not claim self-edits go directly live", /self-edits? (?:go|goes) live|commits? directly to production/i.test(settings), false);

const commit = readFileSync(join(root, "app/api/commit/route.ts"), "utf8");
check("commit route names every credential it accepts", /credentialAdvice\("github"\)/.test(commit), true);
check("commit route does not pretend only GITHUB_PAT works", commit.includes("GITHUB_PAT missing"), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
