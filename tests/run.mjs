#!/usr/bin/env node
/**
 * Run every test file and report one number.
 *
 * These began as throwaway scripts — written to check one fix, run once, and
 * deleted. That meant every regression this app has shipped was a regression
 * nothing was watching for: the tool-calling crash, the screenshot misroute,
 * and the playbook collision were all re-introductions or near-misses of
 * behaviour that had been verified by hand at some earlier point and never
 * again.
 *
 * No framework on purpose. Each file is a plain script that prints PASS/FAIL
 * lines and exits non-zero on failure, which is the whole contract. Adding
 * Vitest would mean a config, a transform, and a dependency to keep current,
 * for a suite that needs none of it.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const files = readdirSync(here)
  .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))
  .sort();

if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}

let failed = 0;
const summary = [];

for (const file of files) {
  const isTs = file.endsWith(".ts");
  const command = isTs ? "npx" : "node";
  const args = isTs
    // tsx resolves the "@/..." paths from tsconfig, so tests import real modules.
    ? ["tsx", "--tsconfig", join(root, "tsconfig.json"), join(here, file)]
    : [join(here, file)];

  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const counts = /(\d+)\/(\d+) passed/.exec(output);
  const ok = result.status === 0;
  if (!ok) failed += 1;

  summary.push(`${ok ? "  ok  " : "FAIL  "}${file.padEnd(26)} ${counts ? counts[0] : ""}`);
  // A passing file's detail is noise; a failing one is the whole point.
  if (!ok) console.log(`\n─── ${file} ───\n${output.trim()}`);
}

console.log(`\n${summary.join("\n")}`);
console.log(failed ? `\n${failed} of ${files.length} test files failed.` : `\nAll ${files.length} test files passed.`);
process.exit(failed ? 1 : 0);
