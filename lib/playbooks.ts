import builtIn from "@/data/playbooks.json";

/**
 * Playbooks: task recipes that shape how Navi approaches a request.
 *
 * These are the counterpart to the on-device skills. A skill is deterministic
 * code that runs without a model — convert a unit, hash a string. A playbook
 * is the opposite: no code at all, just instructions that get folded into the
 * system prompt when the request matches, so the model brings a method rather
 * than improvising one.
 *
 * The format is deliberately the common SKILL.md one — YAML frontmatter with
 * `name` and `description`, then a markdown body — so a skill file written for
 * another tool can be pasted in and read here.
 *
 * "Read here" is the honest claim, and it is narrower than the one this file
 * used to make. Measured against 35 published SKILL.md files: every one
 * parsed, but 22 exceeded MAX_INSTRUCTION_CHARS and were trimmed, the longest
 * keeping a fifth of its body. Files that ship companion scripts or reference
 * documents cannot bring them at all, because a playbook is prompt text and
 * nothing else. Callers are told when a file was trimmed so the user finds out
 * from the app rather than from a playbook that quietly stops mid-instruction.
 */

export type Playbook = {
  id: string;
  name: string;
  /** What it is for. Also the text matched against a request. */
  description: string;
  /** Extra words that should select this playbook, beyond the description. */
  triggers?: string[];
  /** The markdown body, injected verbatim when selected. */
  instructions: string;
  /** Bundled playbooks cannot be edited; pasted ones can be removed. */
  source: "built-in" | "custom";
};

export const BUILT_IN_PLAYBOOKS = (builtIn as Array<Omit<Playbook, "source">>).map((entry) => ({
  ...entry,
  source: "built-in" as const
}));

/** At most one playbook is applied, and its body is bounded. */
const MAX_INSTRUCTION_CHARS = 4_000;
/** Below this the match is a coincidence, not a fit. */
const MIN_SCORE = 3;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "for", "with",
  "from", "into", "about", "is", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "have", "has", "had", "i", "you", "it", "we", "they", "me", "my", "your", "what",
  "how", "why", "when", "where", "which", "who", "can", "could", "would", "should", "will",
  "of", "in", "on", "at", "to", "as", "by", "some", "any", "all", "so", "just", "please",
  "help", "want", "need", "make", "get", "use", "using", "one", "more", "very", "also"
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Parse a SKILL.md file.
 *
 * Accepts what the published skills actually look like rather than insisting
 * on a canonical form: `---` fences, quoted or bare values, and extra
 * frontmatter fields that are simply ignored.
 */
export function parseSkillMarkdown(source: string): { playbook: Omit<Playbook, "source">; truncated: boolean } | { error: string } {
  const text = source.replace(/\r\n/g, "\n").trim();
  const fenced = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!fenced) return { error: "This does not look like a SKILL.md file — it needs a --- frontmatter block at the top." };

  const [, frontmatter, body] = fenced;
  const fields = new Map<string, string>();
  for (const line of frontmatter.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) fields.set(match[1].toLowerCase(), value);
  }

  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) return { error: "The frontmatter is missing a `name` field." };
  if (!description) return { error: "The frontmatter is missing a `description` field." };
  const instructions = body.trim();
  if (!instructions) return { error: "The file has frontmatter but no instructions beneath it." };

  return {
    playbook: {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `playbook-${Date.now()}`,
      name: name.slice(0, 80),
      description: description.slice(0, 400),
      instructions: instructions.slice(0, MAX_INSTRUCTION_CHARS)
    },
    truncated: instructions.length > MAX_INSTRUCTION_CHARS
  };
}

/**
 * Choose the playbook that fits a request, if any.
 *
 * Deliberately conservative: applying the wrong method is worse than applying
 * none, so a weak match returns nothing and the model answers normally.
 */
export function selectPlaybook(request: string, playbooks: Playbook[]): Playbook | null {
  const query = new Set(terms(request));
  if (query.size < 2 || !playbooks.length) return null;

  let best: { playbook: Playbook; score: number } | null = null;
  for (const playbook of playbooks) {
    const haystack = terms(`${playbook.name} ${playbook.description}`);
    const triggerWords = (playbook.triggers ?? []).map((word) => word.toLowerCase());
    let score = 0;
    for (const word of new Set(haystack)) if (query.has(word)) score += 1;
    /* One explicit trigger is enough on its own. Triggers are chosen to be
       specific ("brainstorm", "tdd", "handoff"), so their presence is a real
       signal, where a shared description word is only weak evidence.

       A multi-word phrase outweighs a single word because it is strictly more
       specific: "production is broken" and "broken" both match a bug report,
       but only one of them means the site is down. With a large library the
       single-word matches collide constantly, and without this the winner
       would come down to file order. */
    for (const trigger of triggerWords) {
      if (trigger.includes(" ")) {
        /* Weighted by how many words the phrase pins down, so the longer
           phrase wins when two overlap. "What should I call this function"
           contains both "should i" and "what should i call"; without this it
           was decided by file order, and the decision playbook happened to
           come first. */
        if (request.toLowerCase().includes(trigger)) score += MIN_SCORE + trigger.split(/\s+/).length;
      } else if (query.has(trigger)) {
        score += MIN_SCORE;
      }
    }
    if (!best || score > best.score) best = { playbook, score };
  }
  return best && best.score >= MIN_SCORE ? best.playbook : null;
}

/** Render a playbook for the system prompt. */
export function playbookBlock(playbook: Playbook | null): string {
  if (!playbook) return "";
  return [
    `Apply this method for the current request. It is a playbook the user has installed, named "${playbook.name}".`,
    "Follow it where it applies; if it turns out not to fit what was actually asked, say so briefly and answer properly rather than forcing it.",
    "",
    playbook.instructions.slice(0, MAX_INSTRUCTION_CHARS)
  ].join("\n");
}
