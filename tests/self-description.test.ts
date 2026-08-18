import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROUTES, derivedAppFacts } from "@/lib/ai/self-description";
import { CONNECTOR_KINDS } from "@/lib/ai/types";
import { credentialNames } from "@/lib/ai/credentials";
import { EFFORT_LEVELS, NAVI_MODES } from "@/lib/chat";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── An app that describes a screen it does not have ─────────────────────────
   `APP_KNOWLEDGE` is prose someone wrote about this app, and prose about a
   moving app goes stale. It documented `/settings/Developer` — a section
   deleted long enough ago that `lib/ai/types.ts` carries a comment explaining
   its removal — and it described a voice sheet that no longer exists. Both
   reached the user as an assistant confidently describing something that is
   not there, which is indistinguishable, from the outside, from the assistant
   being broken.

   Prose cannot be derived. The list of screens can be *checked*, and that is
   what this does: it walks the filesystem the way the router does and requires
   the documented list to match exactly. A page added or deleted without
   touching the list fails here instead of becoming a wrong answer months
   later. */

const root = process.cwd();
const appDir = join(root, "app");

/** Every route the App Router serves from a `page.tsx`, as the router sees it. */
function pageRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      /* Route groups and private folders are not path segments. */
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

const actual = pageRoutes(appDir).sort();
const documented = ROUTES.map((route) => route.path).sort();

check("every screen the router serves is documented", actual.filter((path) => !documented.includes(path)), []);
/* The other direction matters just as much, and is the failure that actually
   happened: a screen described in the prompt that nobody can navigate to. */
check("and nothing is documented that does not exist", documented.filter((path) => !actual.includes(path)), []);
check("no screen is listed twice", documented.length, new Set(documented).size);
check("every screen says what it is for", ROUTES.every((route) => route.what.trim().length > 8), true);

/* ── Rendered from the objects, not typed out beside them ──────────────────── */

const facts = derivedAppFacts();

/* The GitHub token was resolved in four modules that read four different sets
   of variables, and the prompt named one of them. Someone following the app's
   own advice configured a capability that stayed off. Naming them from the
   shared list is the only way the advice and the resolver cannot disagree. */
for (const name of credentialNames("github")) {
  check(`the ${name} variable is named`, facts.includes(name), true);
}
/* Committing is the one capability that must not widen when a build platform
   hands over a token, and the description has to say why rather than just
   listing a different set of names. */
check("and the reason commits take a narrower set is stated",
  /build platforms set those two automatically/.test(facts), true);

/* The connectable kinds were a table in the screen and a prose sentence here,
   and the prose was already the stale copy. Now there is one list. */
for (const kind of CONNECTOR_KINDS) {
  check(`${kind.label} is offered`, facts.includes(kind.label), true);
  check(`and says what it is for`, facts.includes(kind.purpose), true);
}

/* Every screen reaches the description, so "what screens are there" is
   answerable without the model reasoning from what it assumes. */
check("every screen appears in the rendered facts",
  ROUTES.every((route) => facts.includes(route.path)), true);

/* ── What it must NOT claim ──────────────────────────────────────────────────
   Which credentials are actually *set* is a runtime fact. Freezing it into a
   prompt makes it stale the moment anything changes, and the app already has a
   tool that reads it live. The description's job is to say which variable
   governs what, and to send the model to look for the rest. */
check("it sends the model to look rather than answering from the prompt",
  /call `inspect_environment` for that/.test(facts), true);
check("and says plainly that it does not carry the answer",
  /never guess it from this list/.test(facts), true);

/* ── Wired, not merely written ───────────────────────────────────────────────
   A block nobody includes is the dead-code shape this repository keeps finding
   in itself — a capability that exists, is tested, and influences nothing. */

const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const knowledge = readFileSync(join(root, "lib/ai/app-knowledge.ts"), "utf8");

check("the derived facts reach the prompt", /derivedAppFacts\(\)/.test(route), true);
/* Carried on the same condition as the prose it accompanies: both answer
   questions about the app, and including one without the other would leave the
   model with half a description. */
check("on the same condition as the prose it accompanies",
  /needsAppKnowledge\(request\) \? derivedAppFacts\(\) : ""/.test(route), true);

/* The drift itself. These are not hypothetical — both shipped. */
check("the deleted Developer screen is gone from the prose",
  /settings\/Developer/.test(knowledge), false);
/* And the duplicates, removed rather than left to disagree with the derived
   copy. Two descriptions of one list is how the stale one gets read. */
check("the screen list is not written out a second time",
  /`\/recents` — all saved chats/.test(knowledge), false);
check("nor the connectable kinds", /OpenAI-compatible, Anthropic-\s*\n?\s*compatible, Supabase, MCP over HTTPS/.test(knowledge), false);
check("nor the credential names", /NAVI_GITHUB_TOKEN/.test(knowledge), false);

/* ── One owner, who is entitled to know what they own ───────────────────────
   The owner block already settled authority — their product decisions are
   final — and left the other half open. Asked what was configured, what a key
   does, or why something was off, the reply came back hedged: the shape a model
   reaches for when a question sounds like it might be about someone else's
   secrets. Nobody else uses this deployment. */

check("the owner is told the configuration is their own property",
  /every question about it — what is set, what is failing, which variable governs what, why a capability is off — is a question about their own property/.test(route), true);
/* The answer has to come from looking. Standing to know is worth nothing if
   the model still answers a configuration question from memory — that is how it
   invented a Settings path and an environment flag in the first place. */
check("and to answer from the tools rather than from memory",
  /from `inspect_environment` and the other diagnostic tools rather than from memory/.test(route), true);
check("and not to hedge as though the setup belonged to someone else",
  /never hedge as though the setup belonged to someone else/.test(route), true);

/* The one thing that stays shut, with the reason stated — a boundary given
   without a reason reads as the same stonewalling this block exists to end. */
check("the credential value is still never printed",
  /Do not print one, because a secret repeated into a conversation is in every copy of that conversation afterwards/.test(route), true);
check("and what is offered instead is named",
  /Name the variable, say whether it is set, say what it enables/.test(route), true);
/* Authority was already settled and must not be traded away for the new half. */
check("authority is still settled too",
  /Their decisions about how NaviOS should look, behave, and be built are final/.test(route), true);
check("and still does not outrank accuracy",
  /This settles authority, not accuracy/.test(route), true);
/* None of it applies to a caller who is not the owner. */
check("and none of this reaches a non-owner", /if \(!isOwner\) return "";/.test(route), true);


/* ── Controls the app could not recognise as its own ─────────────────────────
   The prose said effort had three levels called "Standard, Extended, Maximum".
   The composer has shown Quick, Considered and Deep for a long time. So the
   owner asked what had happened to the three levels of thinking they switch
   between — a control that was on screen and working — and the app, reading its
   own description, did not recognise the names of its own dial.

   Same failure as the credentials and the screens before it: a list written by
   hand drifts from the thing it describes, and the only durable fix is to stop
   writing it down. */

const controls = derivedAppFacts();
for (const level of EFFORT_LEVELS) {
  check(`the ${level.label} effort level is named from the constant`, controls.includes(level.label), true);
}
check("the default is marked as such", /\*\*Considered\*\*[^\n]*The default\./.test(controls), true);
check("both modes are named", NAVI_MODES.every((mode) => controls.includes(mode.label)), true);
/* The names it used to claim, gone from the prose that claimed them. */
const knowledgeCode = readFileSync(join(process.cwd(), "lib/ai/app-knowledge.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
check("the invented level names are gone",
  /Standard, Extended, Maximum/.test(knowledgeCode), false);
check("and the prose defers to the derived list instead",
  /never name them from memory/.test(knowledgeCode), true);
/* Denying a control the user is looking at is worse than admitting a gap. */
check("an unrecognised control is not denied out of hand",
  controls.includes("say so plainly rather than denying the control exists"), true);
/* Interrupting is new and nothing told the model it existed. */
check("talking over it is described", controls.includes("interrupted by talking over it"), true);
console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
