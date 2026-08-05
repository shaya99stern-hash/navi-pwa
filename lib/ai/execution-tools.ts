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

export function buildExecutionTools(options: { origin?: string; cookie?: string } = {}): ToolSet {
  const { origin, cookie } = options;
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
    }),

    /* Python, unlike JavaScript, carries an `execute`. It runs in a virtual
       machine on the server rather than in the browser, so the call goes over
       HTTP to a Node route — the chat route is Edge and cannot import the
       sandbox SDK at all. That boundary is the point, not an inconvenience. */
    ...(origin ? {
      run_python: tool({
        description: [
          "Run Python and get back its output and any error.",
          "Use it for anything JavaScript is a poor fit for: data analysis, numeric work, text processing, and algorithms you would naturally write in Python.",
          "It runs in an isolated virtual machine with no network access and a thirty-second limit.",
          "Write a complete program with no third-party imports. Print what you want to see."
        ].join(" "),
        inputSchema: z.object({
          source: z.string().min(1).max(50_000).describe("A complete Python program. Standard library only, no network."),
          purpose: z.string().max(140).optional().describe("A short note on what this run is checking, shown to the user.")
        }),
        execute: async ({ source }) => {
          try {
            const response = await fetch(new URL("/api/tools/code", origin), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                /* Forwarded so the Node route sees the same signed-in user the
                   chat route did, rather than becoming an unauthenticated way
                   to spend someone else's sandbox allowance. */
                ...(cookie ? { Cookie: cookie } : {})
              },
              body: JSON.stringify({ language: "python", source })
            });
            if (!response.ok) return "The code failed.\n\nError:\nPython execution is unavailable right now.";
            const result = await response.json() as { summary?: string };
            return result.summary ?? "The code failed.\n\nError:\nNothing came back from the run.";
          } catch {
            return "The code failed.\n\nError:\nPython execution could not be reached.";
          }
        }
      })
    } : {})
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
    "- UI components rendering to a DOM cannot be run here. Check their syntax by all means, but do not claim to have seen one render.",
    "- Use `run_python` when the work is naturally Python — data analysis, numeric work, text processing. It runs on the server and takes a few seconds to start, so prefer `run_javascript` for a quick check."
  ].join("\n");
}
