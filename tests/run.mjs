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
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const files = readdirSync(here)
  .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))
  .sort();

if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}

/**
 * How long one test file may take before it is treated as hung.
 *
 * `spawnSync` waits forever by default, so a test that never returns takes the
 * whole suite with it — and CI then sits until the platform's own job limit
 * kills it hours later, with no output saying which file stopped.
 *
 * The suite now contains a test whose entire subject is an infinite loop in the
 * OpenAPI parser. Guarding against a hang with a test that would itself hang is
 * a poor trade: a regression should fail in seconds and name the file.
 *
 * Generous on purpose. The slowest file here runs in a few seconds, so this is
 * far above anything a healthy test does and far below anything worth waiting
 * out.
 */
const FILE_TIMEOUT_MS = 120_000;

let failed = 0;
const summary = [];

for (const file of files) {
  const isTs = file.endsWith(".ts");
  /* Spawn the dependency we installed rather than asking npx to discover it.
     Windows cannot execute npx.cmd through spawnSync without a shell, which
     used to turn every TypeScript test into a silent false failure there. */
  const command = process.execPath;
  const args = isTs
    // tsx resolves the "@/..." paths from tsconfig, so tests import real modules.
    ? [tsxCli, "--tsconfig", join(root, "tsconfig.json"), join(here, file)]
    : [join(here, file)];

  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: FILE_TIMEOUT_MS });
  /* A killed process reports its signal rather than an exit status, and the
     distinction matters: "this test is wrong" and "this test never finished"
     send whoever is reading the log to different places. */
  const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
  const output = timedOut
    ? `Timed out after ${FILE_TIMEOUT_MS / 1000}s without finishing.\n\n${result.stdout ?? ""}${result.stderr ?? ""}`
    : `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
  const counts = /(\d+)\/(\d+) passed/.exec(output);
  const ok = !timedOut && result.status === 0;
  if (!ok) failed += 1;

  summary.push(`${ok ? "  ok  " : timedOut ? "HUNG  " : "FAIL  "}${file.padEnd(26)} ${counts ? counts[0] : ""}`);
  // A passing file's detail is noise; a failing one is the whole point.
  if (!ok) console.log(`\n─── ${file} ───\n${output.trim()}`);
}

console.log(`\n${summary.join("\n")}`);
console.log(failed ? `\n${failed} of ${files.length} test files failed.` : `\nAll ${files.length} test files passed.`);
process.exit(failed ? 1 : 0);
