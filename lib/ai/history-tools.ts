import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Navi Soul looking things up in its own past, on purpose.
 *
 * Recall already runs on every turn: `lib/memory.ts` ranks passages from past
 * conversations and `memoryBlock` pushes four of them into the prompt. That is
 * background context, and it is the right shape for background context — it
 * arrives unasked, it is capped so it cannot crowd out the question, and its
 * threshold is tuned so a coincidence never reaches the model.
 *
 * It is the wrong shape for being *asked*. "When did we last talk about this"
 * needs dates, titles, and however many results exist, and none of those
 * survive a four-passage cap chosen before the question was read. Worse, a
 * question about the past that the automatic pass happened to miss produced an
 * answer reconstructed from nothing — which is the failure this whole codebase
 * keeps finding in itself: not a reasoning error, but nothing letting it look.
 *
 * ## Why this has no `execute`
 *
 * Because the conversations are not here. They live in IndexedDB on the
 * device; the edge runtime has never seen one and never will. A tool declared
 * without an `execute` is forwarded to the client, which runs it and posts the
 * result back — the same path `run_javascript` already takes to reach the
 * sandbox. The alternative was shipping an index of every chat with every
 * request, which spends prompt budget on every turn to serve the few that ask.
 */
export function buildHistoryTools(): ToolSet {
  return {
    search_history: tool({
      description: [
        "Search every saved conversation on this device for what was actually said, and get back the conversation titles, when they happened, and the matching text.",
        "Use it whenever the user refers to the past — 'the last time we talked about', 'what did I tell you about', 'we decided something about this', 'when did we', 'you said' — and whenever you are about to answer from a memory you cannot point at.",
        "Search the distinctive words the user would have typed, not a paraphrase: it matches text literally first, and falls back to topical ranking only when nothing contains those words. Two or three specific terms beat a sentence.",
        "It reads only this user's own conversations on their own device. It cannot see anything else."
      ].join(" "),
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe("The distinctive words to look for, as they would have been typed. Not a question."),
        limit: z.number().int().min(1).max(8).optional().describe("How many conversations to return. Defaults to 8.")
      })
    })
  };
}

/**
 * Told plainly, because a tool a model does not reach for is a tool that does
 * not exist.
 *
 * The specific failure this addresses: asked about something discussed weeks
 * ago, a model answers from whatever the automatic recall pass happened to
 * include, and if it included nothing, it answers anyway. Both readings look
 * identical to the person reading them.
 */
export function historyInstruction(): string {
  return [
    "## Your own history",
    "",
    "Every conversation you have had with this user is saved on their device, and `search_history` reads it.",
    "",
    "- When they refer to something you discussed before, search for it. Do not answer from the context you happen to have been given — that is four passages chosen before the question was asked, and its absence is not evidence that nothing was said.",
    "- Search the words they would have used, not a summary of them. Two or three distinctive terms.",
    "- Say when it was and what the conversation was called, so they can find it again.",
    "- If the search finds nothing, say that nothing was found. Never reconstruct a plausible version of a conversation you cannot point at."
  ].join("\n");
}
