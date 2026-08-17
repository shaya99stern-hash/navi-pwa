/* PATH: tests/navi-soul-mission.test.ts  — NEW FILE, copy verbatim.
   Runs under the existing harness: `npm test` (tests/run.mjs). */

const { runMission, parseSteps, shouldRunAsMission } = require("../lib/ai/navi-soul/mission-loop") as typeof import("../lib/ai/navi-soul/mission-loop");
const { EXTRA_PROSE_ROUTES, EXTRA_SKILL_COUNT } = require("../lib/skills/instant-extra") as typeof import("../lib/skills/instant-extra");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/** Run a query against the extra routes the way `instant.ts` will. */
async function runExtra(query: string): Promise<unknown> {
  for (const route of EXTRA_PROSE_ROUTES) {
    const match = route.pattern.exec(query);
    if (match) {
      const result = await route.run(match);
      return result.ok ? (result as { output: unknown }).output : null;
    }
  }
  return undefined; // no route matched at all
}

const scripted = (replies: string[]) => {
  const queue = [...replies];
  return async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("script exhausted");
    return next;
  };
};

async function main() {
  /* ---- The skills pack: exact answers, zero tokens ---------------------- */
  check("tip math is exact", await runExtra("tip on 84.50 at 20%"), { tip: "16.90", total: "101.40" });
  check("what-percent", await runExtra("12 is what percent of 80"), "15%");
  check("gcd", await runExtra("gcd of 84 and 36"), "12");
  check("prime check", await runExtra("is 977 prime?"), "977 is prime.");
  check("quadratic roots", await runExtra("solve x^2 - 5x + 6 = 0"), "x = 3 or x = 2");
  check("loan payment is a flat object", typeof (await runExtra("payment on 250000 at 6% for 30 years") as { monthlyPayment: string }).monthlyPayment, "string");
  check("hex to rgb", await runExtra("#ec3013 to rgb"), "rgb(236, 48, 19)");
  check("contrast ratio reports WCAG passes", (await runExtra("contrast between #201e1d and #f3f2f2") as { normalTextAA: boolean }).normalTextAA, true);
  check("luhn accepts a structurally valid number", await runExtra("is 4242 4242 4242 4242 a valid card number"), "Passes the Luhn check (structurally valid).");
  check("cidr size", await runExtra("how many ips in /26"), { prefix: "/26", addresses: 64, usableHosts: 62 });
  check("semver bump minor", await runExtra("bump 1.2.3 minor"), "1.3.0");
  check("a prerelease orders below its release", await runExtra("semver 1.3.0-beta vs 1.3.0"), "1.3.0-beta < 1.3.0");
  check("nato spelling", await runExtra("nato spelling of ab"), "Alfa Bravo");
  check("morse encode", await runExtra("morse encode: sos"), "... --- ...");
  check("binary round trip", await runExtra("binary to text: 01101000 01101001"), "hi");
  check("leap year", await runExtra("is 2028 a leap year"), "2028 is a leap year.");
  check("day of week is timezone-proof", await runExtra("what day was 1999-12-31"), "Friday");
  check("date addition", await runExtra("45 days from 2026-01-01"), "2026-02-15");
  check("bytes humanize", await runExtra("1536000 bytes"), "1.46 MB");
  check("duration humanize", await runExtra("9000 seconds"), "2h 30m");
  check("digit masking keeps the last four", await runExtra("mask digits in: card 4242424242424242"), "card ••••••••••••4242");
  check("roman to arabic rejects malformed forms", await runExtra("roman IIII"), null);
  check("prose is never intercepted", await runExtra("what is 2 + 2"), undefined);
  check("the pack reports its own size", EXTRA_SKILL_COUNT >= 50, true);

  /* ---- Decomposition parsing -------------------------------------------- */
  const parsed = parseSteps('Here you go:\n```json\n[{"title":"Convert","instruction":"Convert 5 km to miles","kind":"skill"},{"title":"Write","instruction":"Write the summary","kind":"engine"}]\n```', 6);
  check("steps parse out of fenced prose", parsed.length, 2);
  check("skill kind survives parsing", parsed[0].kind, "skill");
  check("garbage decomposition parses to nothing", parseSteps("sure! here is a plan", 6), []);

  /* ---- Mission trigger stays narrow -------------------------------------- */
  check("multi-part asks are missions", shouldRunAsMission("first research the three main competitors and their pricing, then write a one-page summary comparing them", "medium"), true);
  check("a plain question is never a mission", shouldRunAsMission("why is the sky blue", "high"), false);

  /* ---- The loop: skill-first, budgeted, self-checking --------------------- */
  const decomposition = '[{"title":"Convert","instruction":"convert distance","kind":"skill"},{"title":"Summarise","instruction":"write it up","kind":"engine"}]';
  const full = await runMission("Convert the distance then summarise the route plan for the team offsite because we need it today", {
    runEngine: scripted([decomposition, "The write-up.", "Combined answer.", "PASS"]),
    runSkill: async () => ({ text: "5 km = 3.1 miles", skill: "math.unit-convert" })
  });
  check("a skill step spends no engine call", full.skillHits, 1);
  check("the mission ends by combining", full.answer, "Combined answer.");
  check("engine calls are counted honestly", full.engineCalls, 4);
  check("a passing check reports verified", full.verified, true);
  check("the mission completes", full.status, "complete");

  const broke = await runMission("do several things one by one for this long request that plainly needs multiple stages of work", {
    runEngine: scripted(['[{"title":"A","instruction":"do a","kind":"engine"},{"title":"B","instruction":"do b","kind":"engine"}]', "a done", "b done"])
  }, { maxEngineCalls: 2, verify: false });
  check("a spent budget stops the loop and says so", broke.status, "budget-exhausted");
  check("budget exhaustion still returns the work done", broke.answer.includes("a done"), true);

  const single = await runMission("just one thing", { runEngine: scripted(["not json at all", "42", "PASS"]) });
  check("garbage decomposition degrades to a single step", single.steps.length, 1);
  check("the single step still answers", single.answer, "42");

  /* The script now carries a fifth reply, because a revision is re-checked
     rather than assumed good. That extra call is the fix: `verified` used to be
     set to true on the strength of the revision being a non-empty string — the
     flag asserted a check that never ran, on the one answer already known to
     have failed one. */
  const revised = await runMission("one thing, carefully", {
    runEngine: scripted(["nope", "first draft", "Missing the total.", "Revised answer with the total.", "PASS"])
  });
  check("a failed check earns exactly one revision", revised.answer, "Revised answer with the total.");
  check("the revision is noted", revised.notes.length, 1);
  check("and a revision that passes its re-check is verified", revised.verified, true);

  /* The case the old code called a success: the revision is produced and then
     fails when actually checked. Reporting that as verified is the compounding
     error in miniature — a step claims success, the report carries the claim,
     everything downstream trusts it. */
  const stillWrong = await runMission("one thing, carefully", {
    runEngine: scripted(["nope", "first draft", "Missing the total.", "Still missing it.", "Still missing the total."])
  });
  check("a revision that fails its re-check is not reported as verified", stillWrong.verified, false);
  check("and the note says so", /did not fix it/.test(stillWrong.notes[0] ?? ""), true);

  /* A checker that breaks must not erase the fact that the answer was changed.
     The script runs out before the re-check, which is exactly that failure. */
  const unknown = await runMission("one thing, carefully", {
    runEngine: scripted(["nope", "first draft", "Missing the total.", "Revised answer with the total."])
  });
  check("an unre-checkable revision is unknown, never true", unknown.verified, null);
  check("the revision is still recorded when the re-check breaks", unknown.notes.length, 1);
  check("and says the re-check could not be done", /could not be re-checked/.test(unknown.notes[0] ?? ""), true);
  check("while the revised answer is still delivered", unknown.answer, "Revised answer with the total.");

  /* Verification used to be unreachable by arithmetic: 1 decompose + 6 steps +
     1 synthesis spent the whole budget of 8, so the check never ran on exactly
     the long missions where it matters most. The reserve is enforced at the
     call counter, so steps cannot spend it. */
  const reserved = await runMission("do several things one by one across a long multi-stage brief that needs real decomposition", {
    runEngine: scripted([
      '[{"title":"A","instruction":"a","kind":"engine"},{"title":"B","instruction":"b","kind":"engine"}]',
      "a", "b", "combined", "PASS"
    ])
  }, { maxEngineCalls: 6 });
  /* Six calls, two held back: decompose + two steps + synthesis fills the step
     ceiling exactly, and the check still runs. Under the old budget this is the
     shape that silently skipped verification. */
  check("a mission that fills its step budget is still verified", reserved.verified, true);
  check("and the reserve was what paid for it", reserved.engineCalls, 5);

  /* The reserve binds the step phase, not just the total: steps stop at the
     ceiling and report exhaustion rather than eating the check's budget. */
  const squeezed = await runMission("do several things one by one across a long multi-stage brief that needs real decomposition", {
    runEngine: scripted([
      '[{"title":"A","instruction":"a","kind":"engine"},{"title":"B","instruction":"b","kind":"engine"},{"title":"C","instruction":"c","kind":"engine"}]',
      "a", "b", "c", "combined", "PASS"
    ])
  }, { maxEngineCalls: 6 });
  check("steps cannot spend the verification reserve", squeezed.status, "budget-exhausted");

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

export {};
