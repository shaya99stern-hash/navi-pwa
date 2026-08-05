import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { getSpendStore, ledgerKey } from "@/lib/ai/spend";

/**
 * Python, in a real virtual machine.
 *
 * The in-browser worker runs JavaScript and cannot run anything else: no
 * interpreter, no filesystem, no packages. Shipping a multi-megabyte
 * WebAssembly Python to a phone to close that gap is the wrong trade — it
 * would be paid on every session by everyone, to serve the few turns that need
 * it. A microVM on the server closes it for free.
 *
 * This module is Node-only and must never be imported by the edge chat route.
 * That is what `/api/tools/code` is for: the route runs on Node, this runs
 * inside it, and the chat route reaches it over HTTP. Importing it directly
 * produces a build failure that reads like a dependency error and wastes an
 * afternoon.
 *
 * ## Why the worker keeps JavaScript
 *
 * Creating a microVM takes seconds; a worker takes milliseconds. Most runs are
 * a snippet of JavaScript being checked, and routing those through here would
 * pay a startup cost on the common case to serve the rare one. Each engine
 * takes the work it is actually better at.
 */

export type SandboxResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

/** Hard wall clock, per the spec. */
export const SANDBOX_TIMEOUT_MS = 30_000;
/** Beyond this the output is noise in a conversation, not information. */
const MAX_OUTPUT_CHARS = 6_000;
/** The free tier's monthly sandbox creations. */
const MONTHLY_CREATIONS = 5_000;
/** Stop here so the last creations are headroom rather than a cliff. */
const DISABLE_AT = 0.9;

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated at ${MAX_OUTPUT_CHARS} characters.`;
}

function creationsKey(): string {
  return `${ledgerKey()}:sandbox`;
}

function allowance(): number {
  const value = Number(process.env.NAVI_SANDBOX_MONTHLY_CREATIONS);
  return Number.isFinite(value) && value > 0 ? value : MONTHLY_CREATIONS;
}

/**
 * Whether another sandbox may be created.
 *
 * Fails *closed*, unlike the search ceiling. Sandboxes are billed on active
 * CPU past the free allotment, so an unreadable counter here could cost money
 * where an unreadable search counter only costs a worse answer.
 */
export async function sandboxAllowed(): Promise<boolean> {
  const used = await getSpendStore().read(creationsKey()).catch(() => allowance());
  return used < allowance() * DISABLE_AT;
}

async function recordCreation(): Promise<void> {
  await getSpendStore().add(creationsKey(), 1).catch((error) => {
    console.error("NaviSoul could not record a sandbox creation:", error);
  });
}

/**
 * Run Python and come back with what happened.
 *
 * Never throws, for the same reason the browser sandbox never rejects: the
 * caller's repair loop should handle one shape — the code was wrong — rather
 * than two. Infrastructure failures arrive as a result with the reason in
 * `stderr`, which is also what the model needs in order to say something true
 * about them.
 */
export async function runPython(source: string): Promise<SandboxResult> {
  const fail = (stderr: string, timedOut = false): SandboxResult =>
    ({ ok: false, stdout: "", stderr, exitCode: 1, timedOut });

  if (!(await sandboxAllowed())) {
    return fail("Python execution is unavailable for the rest of this period. Answer from your own knowledge and say plainly that you could not run it.");
  }

  let sandbox: Sandbox | undefined;
  try {
    await recordCreation();
    sandbox = await Sandbox.create({
      runtime: "node24",
      /* Verified against the package's own types: the policy accepts the
         literal "deny-all". Executed code reaches nothing — no package index,
         no API, no metadata endpoint. */
      networkPolicy: "deny-all",
      timeout: SANDBOX_TIMEOUT_MS
    });

    await sandbox.writeFiles([{ path: "main.py", content: Buffer.from(source, "utf8") }]);
    const finished = await sandbox.runCommand({
      cmd: "python3",
      args: ["main.py"],
      /* Not root. The code being run was written by a model, and a model can be
         talked into writing something hostile by content in its own context. */
      sudo: false
    });

    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    return {
      ok: finished.exitCode === 0,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exitCode: finished.exitCode,
      timedOut: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NaviSoul sandbox run failed:", error);
    if (/timeout|timed out|deadline/i.test(message)) {
      return fail(`Execution was stopped after ${SANDBOX_TIMEOUT_MS}ms. The code did not finish — check for a loop that never ends.`, true);
    }
    return fail("The sandbox could not run that.");
  } finally {
    /* Stopped explicitly rather than left to the timeout. A sandbox that idles
       until its wall clock expires keeps counting against the concurrency
       limit, which is ten — enough to lock out every other request. */
    await sandbox?.stop().catch(() => {});
  }
}

/** How a run is described back to the model. Failure first, as in the worker. */
export function describeSandboxResult(result: SandboxResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? "The code ran successfully." : "The code failed.");
  if (result.stderr) lines.push(`Error:\n${result.stderr}`);
  if (result.stdout) lines.push(`Output:\n${result.stdout}`);
  if (result.ok && !result.stdout) lines.push("It produced no output. Print something to show the result.");
  return lines.join("\n\n");
}
