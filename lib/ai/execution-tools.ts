import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * The code-execution tool, executed on the device rather than on the server.
 *
 * Note what is missing: an `execute` function. A tool defined without one is
 * forwarded to the client, which runs it and submits the result back into the
 * same conversation. That is what makes the repair loop possible at all here —
 * the sandbox is a worker in the browser, and the server cannot reach into it.
 *
 * The capability used to be described as "enabled only when the selected route
 * actually supplies it", which made a core ability hostage to whichever
 * provider happened to answer. It is ours now, and it works the same on every
 * route that can call a tool.
 */

/** Beyond this a model is thrashing, not debugging. */
export const MAX_REPAIR_ROUNDS = 3;

export function buildExecutionTools(): ToolSet {
  return {
    run_javascript: tool({
      description: [
        "Run JavaScript and get back its output and any error.",
        "Use this to CHECK your own work before presenting it: algorithms, data transforms, regex, parsing, date and unit maths, sorting, and anything numeric.",
        "If it fails, read the error, fix the code, and run it again.",
        "The code runs in an isolated sandbox on the user's device: no network, no file system, no access to the page, and a few seconds of wall clock.",
        "Write self-contained code with no imports or requires. Log or return what you want to see."
      ].join(" "),
      inputSchema: z.object({
        code: z.string().min(1).max(20_000).describe("Self-contained JavaScript. No imports, no network calls."),
        purpose: z.string().max(140).optional().describe("A short note on what this run is checking, shown to the user.")
      })
    })
  };
}

/**
 * Instructions that turn a tool into a habit.
 *
 * A model with an execution tool available still tends to reason its way to an
 * answer and present it, because that is what it does when it has no tool. The
 * gain only arrives if it actually runs things, so the prompt says when to run,
 * how many times to repair, and — the part that matters most — what it must not
 * claim when the last run still failed.
 */
export function executionInstruction(): string {
  return [
    "## Running code",
    "",
    "You can run JavaScript with `run_javascript`, and its results are real.",
    "",
    "- Before you present any algorithm, data transform, regex, parser, or calculation, run it. Do not reason about whether it works when you can find out.",
    "- Never do arithmetic, date maths, unit conversion, sorting, or counting in your head. Run it. Approximating these is the most common way you are wrong.",
    `- If a run fails, read the actual error, fix the cause, and run again. Stop after ${MAX_REPAIR_ROUNDS} attempts.`,
    "- If the last run still failed, say so plainly and state the remaining error. Never present code that failed as though it worked, and never quietly drop the part that would not run.",
    "- Do not run code that needs the network, the file system, or a package. It will fail, and you will have spent an attempt learning that.",
    "- UI components rendering to a DOM cannot be run here. Check their syntax by all means, but do not claim to have seen one render."
  ].join("\n");
}
