import { tool, type ToolSet } from "ai";
import { z } from "zod";

/* The storage module is server-only and is loaded inside the tool call, so
   importing this builder (and the registry above it) stays safe anywhere.
   The availability check duplicates the storage module's env read for the
   same reason — it must run without importing it. */
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

/**
 * The tool that makes "learn this and keep it" true.
 *
 * Navi Soul used to answer that request with a claim — "stored in durable
 * memory" — backed by nothing. Now the claim has a write behind it: the skill
 * goes into the user's own Supabase rows and is injected into every future
 * conversation's prompt. The tool exists only when the user is signed in and
 * storage is configured, so the model is never offered a promise it cannot
 * keep.
 */
export function buildLearningTools({ clerkToken, clerkUserId, onActivity = () => {} }: {
  clerkToken?: string;
  clerkUserId?: string;
  onActivity?: (label: string) => void;
}): ToolSet {
  if (!clerkToken || !clerkUserId || !storageConfigured()) return {};

  return {
    learn_skill: tool({
      description:
        "Permanently store a skill for this user — a distilled technique, workflow, reference, or set of instructions they want you to keep and apply in future conversations. Use it whenever the user asks you to learn, remember, save, or keep something reusable, especially content you just read from a link. Distill first: store the usable essence, not a raw page dump. Storing under an existing name updates that skill.",
      inputSchema: z.object({
        name: z.string().describe("Short stable name, e.g. 'Claude Vision workflow' or 'Terraform review checklist'."),
        description: z.string().optional().describe("One sentence on when this skill applies."),
        instructions: z.string().describe("The skill itself, in markdown: the steps, patterns, code, or reference material to apply."),
        sourceUrl: z.string().optional().describe("Where this was learned from, when it came from a link.")
      }),
      execute: async ({ name, description, instructions, sourceUrl }) => {
        onActivity(`Learning “${name}”`);
        const { rememberSkill } = await import("../memory/learned-skills");
        const stored = await rememberSkill(clerkToken, clerkUserId, { name, description, instructions, sourceUrl });
        return stored
          ? `Learned and stored permanently: "${stored.name}". It will be available in every future conversation. Tell the user it is saved — this time it is true.`
          : "The skill could not be stored. Say so plainly rather than claiming it was saved.";
      }
    })
  };
}
