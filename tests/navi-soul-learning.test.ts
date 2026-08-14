/* PATH: tests/navi-soul-learning.test.ts  — NEW FILE, copy verbatim.
   Runs under the existing harness: `npm test` (tests/run.mjs). */

const { ingestContent, learnFromMission, parseLessons, suggestNewSkills, wantsLearning } = require("../lib/ai/navi-soul/learning-loop") as typeof import("../lib/ai/navi-soul/learning-loop");
const { EXTRA_MATH_TIME_ROUTES, EXTRA_MATH_TIME_COUNT } = require("../lib/skills/instant-extra-2") as typeof import("../lib/skills/instant-extra-2");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

async function runExtra(query: string): Promise<unknown> {
  for (const route of EXTRA_MATH_TIME_ROUTES) {
    const match = route.pattern.exec(query);
    if (match) {
      const result = await route.run(match);
      return result.ok ? (result as { output: unknown }).output : null;
    }
  }
  return undefined;
}

async function main() {
  /* ---- The math & time pack --------------------------------------------- */
  check("combinatorics are exact", await runExtra("52 choose 5"), "C(52, 5) = 2598960");
  check("permutations", await runExtra("permutations of 3 from 5"), "P(5, 3) = 60");
  check("integer roots come back as integers", await runExtra("cube root of 729"), "9");
  check("logs of exact powers are exact", await runExtra("log base 2 of 1024"), "10");
  check("power check names the exponent", await runExtra("is 4096 a power of 2"), "Yes: 2^12 = 4096.");
  check("decimal to fraction reduces", await runExtra("0.375 as a fraction"), "3/8");
  check("fractions simplify", await runExtra("simplify fraction 12/18"), "2/3");
  check("ordinals respect the teens", await runExtra("ordinal of 11"), "11th");
  check("ordinals", await runExtra("ordinal of 42"), "42nd");
  check("thousands separators", await runExtra("1234567 with commas"), "1,234,567");
  check("hypotenuse", await runExtra("hypotenuse of 3 and 4"), "5");
  check("circle area", await runExtra("area of a circle with radius 5"), "78.5398163397");
  check("vat added is itemised", await runExtra("add 20% vat to 150"), { gross: "180.00", taxAmount: "30.00" });
  check("margin", await runExtra("margin if cost 25 price 40"), "37.5%");
  check("break-even rounds up to whole units", await runExtra("break even if fixed costs 10000 price 25 cost 15"), "1000 units");
  check("bmi", await runExtra("bmi for 70 kg and 1.75 m"), "22.9");
  check("running pace", await runExtra("pace for 10k in 52 minutes"), "5:12 per km");
  check("hours between clock times", await runExtra("hours between 9:30 and 17:15"), "7h 45m");
  check("adding hours crosses noon correctly", await runExtra("3:45pm plus 5 hours"), "8:45 PM");
  check("minutes to hours", await runExtra("135 minutes in hours and minutes"), "2h 15m");
  check("business days skip the weekend", await runExtra("business days between 2026-08-10 and 2026-08-14"), "4 business days (weekdays after 2026-08-10, through 2026-08-14)");
  check("quarters", await runExtra("what quarter is 2026-08-14"), "Q3 2026");
  check("leap february", await runExtra("days in february 2028"), "29");
  check("the clock skills answer from the device clock", typeof (await runExtra("time in tokyo")), "string");
  check("zone conversion names the target", String(await runExtra("3pm in new york to london")).includes("in london"), true);
  check("an unknown city misses honestly", await runExtra("time in gotham"), null);
  check("prose is never intercepted", await runExtra("what is the area of Texas"), undefined);
  check("the pack reports its own size", EXTRA_MATH_TIME_COUNT >= 40, true);

  /* ---- Learning: fed content -------------------------------------------- */
  const lessons = parseLessons('Notes:\n```json\n[{"kind":"procedure","statement":"Edge runtime modules are evaluated more than once per isolate, so caches belong on globalThis.","confidence":"stated"},{"kind":"bogus","statement":"too short"},{"kind":"fact","statement":"Edge runtime modules are evaluated more than once per isolate, so caches belong on globalThis."}]\n```', "test");
  check("lessons parse out of fenced prose", lessons.length, 1);
  check("a lesson keeps its kind", lessons[0].kind, "procedure");

  const noFetcher = await ingestContent({ kind: "url", value: "https://example.com/post" }, {
    runEngine: async () => "[]",
    storeLessons: async () => 0
  });
  check("a URL without a fetcher fails honestly", noFetcher.notes[0].includes("Paste the content"), true);

  const video = await ingestContent({ kind: "url", value: "https://youtube.com/watch?v=abc" }, {
    runEngine: async () => "[]",
    fetchPage: async () => { throw new Error("blocked"); },
    storeLessons: async () => 0
  });
  check("a video that cannot be read asks for its transcript", video.notes[0].includes("transcript"), true);

  const stored = await ingestContent(
    { kind: "transcript", value: ("Edge functions cold-start per region. ").repeat(20), title: "talk" },
    {
      runEngine: async () => '[{"kind":"fact","statement":"Edge functions cold-start once per region rather than once per deployment.","confidence":"stated"}]',
      storeLessons: async (batch) => batch.length
    }
  );
  check("fed content becomes stored lessons", stored.stored, 1);
  check("the lesson carries its source", stored.lessons[0].source, "talk");

  /* ---- Learning: its own missions, zero tokens --------------------------- */
  const mined = learnFromMission({
    status: "budget-exhausted", request: "research the market and write the plan",
    engineCalls: 8, verified: null, notes: ["revised once"], failedSteps: ["Fetch pricing"]
  });
  check("a spent budget becomes a procedure lesson", mined.some((lesson) => lesson.kind === "procedure" && lesson.statement.includes("8 engine calls")), true);
  check("a failed step becomes a correction", mined.some((lesson) => lesson.kind === "correction" && lesson.statement.includes("Fetch pricing")), true);
  check("mission lessons are marked inferred", mined.every((lesson) => lesson.confidence === "inferred"), true);

  check("learn-asks are recognised", wantsLearning("learn this: the deploy window is Tuesdays"), true);
  check("mentions of learning are not learn-asks", wantsLearning("tell me about machine learning"), false);

  const suggestions = suggestNewSkills(["convert 5 km to miles", "convert 3 kg to lbs", "why is the sky blue"]);
  check("lane-0 misses cluster into skill suggestions", suggestions[0]?.family, "conversion");
  check("suggestion counts are honest", suggestions[0]?.count, 2);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

export {};
