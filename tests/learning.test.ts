import { readFileSync } from "node:fs";
import { join } from "node:path";
import { youTubeVideoId } from "@/lib/ai/web-tools";
import { buildToolset, type ToolsetContext } from "@/lib/tools/registry";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── YouTube URL recognition ────────────────────────────────────────────── */

const id = (raw: string) => youTubeVideoId(new URL(raw));
check("a watch url", id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("a short link", id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("a shorts url", id("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("an embed url", id("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("a mobile url", id("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("an unrelated site is not a video", id("https://example.com/watch?v=abc123def45"), null);
check("a lookalike host is not a video", id("https://notyoutube.com/watch?v=abc123def45"), null);

/* ── The learning tool appears only when it can keep its promise ────────── */

const context = (overrides: Partial<ToolsetContext>): ToolsetContext => ({
  mode: "chat",
  policy: { web: false, code: false, artifacts: true },
  signal: new AbortController().signal,
  ...overrides
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";

check("signed in offers learn_skill", "learn_skill" in buildToolset(context({ clerkToken: "t", clerkUserId: "u" })), true);
check("signed out does not offer learn_skill", "learn_skill" in buildToolset(context({})), false);
check("a token without a user does not offer it", "learn_skill" in buildToolset(context({ clerkToken: "t" })), false);

/* ── Learning from itself, not only from instruction ────────────────────── */

/* `learn_skill` stores what the user teaches. Nothing stored what NaviSoul
   worked out on its own, so every conversation re-derived the same ground: the
   shape of this codebase, which provider is unreliable, what a particular
   phrasing always turns out to mean. */
check("signed in offers record_lesson", "record_lesson" in buildToolset(context({ clerkToken: "t", clerkUserId: "u" })), true);
check("signed out does not offer record_lesson", "record_lesson" in buildToolset(context({})), false);
check("a token without a user cannot record a lesson", "record_lesson" in buildToolset(context({ clerkToken: "t" })), false);

const reflection = readFileSync(join(process.cwd(), "lib/ai/reflection-tools.ts"), "utf8");
/* A model asked to reflect will produce a lesson after every turn, and forty
   vacuous entries crowd out the four worth keeping. Most of the tool
   description is about when not to call it, and that is load-bearing. */
check("the tool argues against over-recording", /Do NOT call it for/.test(reflection), true);
check("it says one lesson is normal", /One lesson per conversation is normal/.test(reflection), true);
check("it refuses to claim an unmade save", /Do not claim it was/.test(reflection), true);
/* A tool nothing prompts is a tool nothing calls. */
check("the instruction reaches the prompt", routeSourceHasReflection(), true);

/* ── A lesson is not a skill, and is not described as one ───────────────── */

/* Rendering both under "skills this user has taught you" would present every
   self-derived guess as a standing instruction from the user — a short path to
   NaviSoul defending its own mistaken inference as something it was told. */
const skillsSource = readFileSync(join(process.cwd(), "lib/memory/learned-skills.ts"), "utf8");
check("the two are separated when rendered", skillsSource.includes("What you worked out for yourself"), true);
check("lessons are marked as its own conclusions", /not instructions from the user/.test(skillsSource), true);
check("evidence yields to what is visible now", /trust what you can see/.test(skillsSource), true);

function routeSourceHasReflection(): boolean {
  const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  return source.includes("REFLECTION_INSTRUCTION") && /const memoryContext = \[[^\]]*reflectionContext/.test(source);
}

/* ── The prompt block contract, checked without a network ───────────────── */

const source = readFileSync(join(process.cwd(), "lib/memory/learned-skills.ts"), "utf8");
check("skills are read with the caller's own token", source.includes("Authorization: `Bearer ${clerkToken}`"), true);
check("no service role key is referenced", /SERVICE_ROLE|serviceRole/.test(source), false);
check("the block tells the model the skills are its own", source.includes("apply them without being reminded"), true);

const routeSource = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
check("learned skills reach the prompt", routeSource.includes("learnedSkillsBlock(storedSkills)"), true);
check("skills sit in the memory context", routeSource.includes("skillsContext"), true);

const webSource = readFileSync(join(process.cwd(), "lib/ai/web-tools.ts"), "utf8");
check("fetch_url reads pdfs", webSource.includes("extractPdfText"), true);
check("fetch_url reads video transcripts", webSource.includes("fetchYouTubeTranscript"), true);
check("the ssrf guard is still in place", webSource.includes("isPrivateHostname"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
