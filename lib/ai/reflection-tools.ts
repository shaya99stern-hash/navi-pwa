import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { LESSON_PREFIX } from "../memory/lesson";

/**
 * Learning from what just happened.
 *
 * `learn_skill` stores what the *user* teaches. Nothing stored what Navi Soul
 * worked out for itself, so the same ground was re-covered every time: the
 * shape of this codebase, which provider is unreliable, that a particular
 * request always means a particular thing. Each conversation started from the
 * same place regardless of how much had been figured out in the last one.
 *
 * A lesson is a different object from a skill even though both live in the
 * same store. A skill is instruction — "here is how to do X". A lesson is
 * evidence — "when I did X, Y happened, so next time do Z". Naming them
 * apart keeps the distinction visible in the prompt, where it changes how
 * much weight each deserves.
 *
 * The discipline that matters is restraint. A model asked to reflect will
 * happily produce a lesson after every turn, and forty vacuous entries crowd
 * out the four that were worth keeping. The tool description spends most of
 * its words on when *not* to call it.
 */

/**
 * Prefix that marks a stored skill as self-learned rather than user-taught.
 *
 * Re-exported rather than declared here, because the writer is not the only
 * side that has to recognise it — see `lib/memory/lesson`.
 */
export { LESSON_PREFIX };

function storageConfigured(): boolean {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? ""
  ).trim();
  return url.startsWith("https://") && Boolean(key);
}

export function buildReflectionTools({ clerkToken, clerkUserId, onActivity = () => {} }: {
  clerkToken?: string;
  clerkUserId?: string;
  onActivity?: (label: string) => void;
}): ToolSet {
  if (!clerkToken || !clerkUserId || !storageConfigured()) return {};

  return {
    record_lesson: tool({
      description:
        "Store something you worked out yourself, so it is available in every future conversation. Call this ONLY when you learned something durable and non-obvious that would change how you act next time: a fact about how this user's setup actually behaves, a repeated failure and its real cause, a technique that worked after something else did not, or a correction the user made to your understanding. Do NOT call it for: anything the user could have told you, restating what you just said, ordinary task results, or things true of every project rather than this one. One lesson per conversation is normal; several is almost always wrong. A vague lesson is worse than none, because it crowds out the ones that matter.",
      inputSchema: z.object({
        topic: z.string().describe("Short subject, e.g. 'Voice transcription formats' or 'This user's Vercel setup'."),
        lesson: z.string().describe("What you learned, in a form that changes future behaviour: what happened, why, and what to do differently. Be specific and concrete."),
        trigger: z.string().optional().describe("When this should come to mind again, e.g. 'when transcription fails' or 'before editing the composer'.")
      }),
      execute: async ({ topic, lesson, trigger }) => {
        onActivity("Recording what I learned");
        const { rememberSkill } = await import("../memory/learned-skills");
        const stored = await rememberSkill(clerkToken, clerkUserId, {
          name: `${LESSON_PREFIX} ${topic}`.slice(0, 120),
          description: trigger ? `Recall ${trigger}.` : "Learned from experience.",
          instructions: [lesson, trigger ? `\nRecall this ${trigger}.` : ""].filter(Boolean).join("\n")
        });
        return stored
          ? `Recorded. This will be in front of you in every future conversation, so do not re-derive it.`
          : "The lesson could not be stored. Do not claim it was.";
      }
    })
  };
}

/**
 * The instruction that makes reflection happen at all.
 *
 * A tool nothing prompts is a tool nothing calls. This is deliberately short
 * and placed with the memory context, where the model is already thinking
 * about what it knows.
 */
export const REFLECTION_INSTRUCTION = [
  "You can learn from your own experience with record_lesson, and what you record reaches every future conversation.",
  "Use it at the end of a task where you discovered something durable: a real cause behind a repeated failure, how this user's setup actually behaves, or a correction they made to your understanding. Prefer the specific over the general — a lesson that would apply to any project is not worth storing.",
  "Do not record a lesson for ordinary work, and never record one to appear diligent. Most turns should record nothing."
].join("\n");
