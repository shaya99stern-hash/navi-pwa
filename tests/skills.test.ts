import { BUILT_IN_PLAYBOOKS, parseSkillMarkdown, selectPlaybook, playbookBlock, type Playbook } from "@/lib/playbooks";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};

// A real skill in the format published for Claude, pasted verbatim.
const SKILL = `---
name: Hebrew Date Conversion
description: Convert between Gregorian and Hebrew calendar dates, including holidays and parsha.
---

# Hebrew Date Conversion

1. Establish which direction the conversion goes before converting.
2. Hebrew dates begin at nightfall — state which civil day is meant.
3. Give the Hebrew date in both transliteration and Hebrew script.
4. Note the parsha or holiday when the date falls on one.
`;

const parsed = parseSkillMarkdown(SKILL);
check("a pasted SKILL.md parses", "playbook" in parsed, true);
if (!("playbook" in parsed)) process.exit(1);

// This is exactly what app-shell does: custom entries merge with the built-ins.
const installed: Playbook[] = [
  ...BUILT_IN_PLAYBOOKS,
  { ...parsed.playbook, source: "custom" as const }
];
check("library grew by one", installed.length, BUILT_IN_PLAYBOOKS.length + 1);

// It must actually win its own request, competing against all 36 built-ins.
const chosen = selectPlaybook("convert this to the hebrew date please", installed);
check("the pasted skill is selected on a real request", chosen?.id, "hebrew-date-conversion");
check("it is marked as custom", chosen?.source, "custom");

// Its instructions must reach the prompt verbatim, not a summary.
const block = playbookBlock(chosen);
check("instructions reach the prompt", block.includes("Hebrew dates begin at nightfall"), true);
check("all four steps survive", ["Establish which direction", "begin at nightfall", "transliteration", "parsha or holiday"].every((f) => block.includes(f)), true);
check("the prompt names it as installed", block.includes('named "Hebrew Date Conversion"'), true);

// Installing it must not break the built-ins.
check("built-ins still win their own requests", selectPlaybook("my vercel build failed", installed)?.id, "ship-to-vercel");
/* A poem request correctly picks the writing playbook — the assertion is
   that the pasted skill does not hijack unrelated requests. */
check("unrelated request does not pick the pasted skill", selectPlaybook("write me a short poem about rain", installed)?.id !== "hebrew-date-conversion", true);
check("unrelated request picks a sensible built-in", selectPlaybook("write me a short poem about rain", installed)?.id, "clear-writing");

// Malformed input is rejected with a reason rather than silently ignored.
const bad = parseSkillMarkdown("just some text with no frontmatter");
check("malformed input is rejected", "error" in bad, true);
const noDesc = parseSkillMarkdown("---\nname: X\n---\n\nbody");
check("missing description is rejected", "error" in noDesc, true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
