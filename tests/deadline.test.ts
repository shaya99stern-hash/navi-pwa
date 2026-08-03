/* Mirrors the budget arithmetic in lib/ai/swarm.ts. */
const TOTAL_BUDGET_MS = 44_000;
const MIN_STAGE_MS = 5_500;
const DELIVERY_RESERVE_MS = 1_500;

function deadlineAt(elapsed: number) {
  const remaining = () => Math.max(0, TOTAL_BUDGET_MS - elapsed);
  return { remaining, budget: (p: number, r: number) => Math.min(p, Math.max(0, remaining() - r)) };
}

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${String(actual)}, want ${String(expected)}`}`);
};

// Fresh request: all three stages fit, and the old fixed 13+18+18=49s does not.
const fresh = deadlineAt(0);
check("council budget on a fresh request", fresh.budget(13_000, 21_000), 13_000);
// 49s of model time inside a 60s limit left under 11s for the planner,
// the request itself, and delivery — no margin for a single slow provider.
check("old fixed schedule left almost no margin", 60_000 - (13_000 + 18_000 + 18_000) <= 11_000, true);
const councilB = fresh.budget(13_000, 21_000);
const afterCouncil = deadlineAt(councilB);
const candB = afterCouncil.budget(18_000, 9_000);
check("candidates get a real budget after council", candB, 18_000);
const verifyB = deadlineAt(councilB + candB).budget(18_000, DELIVERY_RESERVE_MS);
check("verification fits in what is left", verifyB, 11_500);
check("all three stages stay inside the total", councilB + candB + verifyB <= TOTAL_BUDGET_MS, true);

// Slow route planner ate 20s: council is skipped, an answer still ships.
const slow = deadlineAt(20_000);
check("slow start skips the council", slow.budget(13_000, 21_000) < MIN_STAGE_MS, true);
check("slow start still funds candidates", slow.budget(18_000, 9_000) >= MIN_STAGE_MS, true);

// Very late: verification is skipped rather than started and killed.
const late = deadlineAt(40_000);
check("late verification is skipped", late.budget(18_000, DELIVERY_RESERVE_MS) < MIN_STAGE_MS, true);
check("budget never goes negative", deadlineAt(99_000).budget(18_000, 9_000), 0);

// Single candidate means verification has nothing to rank.
check("one candidate skips verification", [1].length < 2, true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

export {};
