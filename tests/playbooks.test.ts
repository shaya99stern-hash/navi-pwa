import { BUILT_IN_PLAYBOOKS, selectPlaybook, parseSkillMarkdown } from "@/lib/playbooks";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};
const pick = (q: string) => selectPlaybook(q, BUILT_IN_PLAYBOOKS)?.id ?? null;

// Every playbook must have a unique id, real triggers, and a real body.
const ids = new Set(BUILT_IN_PLAYBOOKS.map((p) => p.id));
check("ids are unique", ids.size, BUILT_IN_PLAYBOOKS.length);
check("all have triggers", BUILT_IN_PLAYBOOKS.every((p) => (p.triggers ?? []).length >= 4), true);
check("all have substantial bodies", BUILT_IN_PLAYBOOKS.every((p) => p.instructions.length > 400), true);
check("all bodies start with a heading", BUILT_IN_PLAYBOOKS.every((p) => p.instructions.startsWith("# ")), true);

// The new playbooks fire on their real-world phrasings.
check("deploy failure", pick("my vercel build failed after i pushed"), "ship-to-vercel");
check("iphone layout", pick("the composer is hidden behind the home indicator on iphone"), "mobile-pwa-review");
check("site down", pick("production is broken and users cant sign in"), "incident-triage");
check("slow app", pick("the chat list is really slow and laggy when scrolling"), "performance-tuning");
check("exposed key", pick("is my api key exposed to the browser"), "security-review");
check("orientation", pick("walk me through how this codebase handles routing"), "read-unfamiliar-code");
check("receipt", pick("extract the line items from this receipt into a table"), "extract-structured-data");
check("pr body", pick("write the pr description for this change"), "write-the-pull-request");
check("upgrade", pick("upgrade react to the new version, whats the breaking change"), "upgrade-a-dependency");
check("engine choice", pick("which model should i use for classification"), "choose-a-model");
check("prompt work", pick("improve my system prompt so it stops padding"), "design-the-prompt");
check("sound", pick("make a notification sound for new messages"), "sound-and-music-brief");
check("estimate", pick("how long would it take to build the settings screen"), "scope-and-estimate");
check("a11y", pick("check this for screen reader accessibility"), "accessibility-review");
check("summary", pick("summarize this article for me"), "summarize-faithfully");
check("naming", pick("what should i call this function"), "name-things-well");
check("quota", pick("im hitting the free tier rate limit"), "reduce-the-cost");
check("verification", pick("are you sure that number is right"), "verify-before-claiming");

// Existing playbooks must not regress now that the library is twice the size.
check("debugging still wins", pick("im getting a stack trace when i click send"), "root-cause-debugging");
check("code review still wins", pick("can you do a code review of this diff"), "code-review");
check("tdd still wins", pick("lets do tdd for this, write tests first"), "test-driven-development");

// The specificity rule: a phrase must beat a bare word.
check("phrase beats word", pick("production is broken"), "incident-triage");

// Nothing should fire on ordinary chat.
check("greeting selects nothing", pick("hey there how are you"), null);
check("single word selects nothing", pick("thanks"), null);

// SKILL.md import still works, so pasted Claude skills keep functioning.
const parsed = parseSkillMarkdown('---\nname: Test Skill\ndescription: A test.\n---\n\nDo the thing.');
check("SKILL.md parses", "playbook" in parsed && parsed.playbook.id, "test-skill");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
