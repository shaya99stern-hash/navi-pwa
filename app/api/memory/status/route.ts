import { NextResponse } from "next/server";

import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import { cloudMemoryConfigured, listCloudChats } from "@/lib/memory/cloud";
import { factsConfigured, listFacts } from "@/lib/memory/facts";
import { learnedSkillsConfigured, listLearnedSkills } from "@/lib/memory/learned-skills";
import { isLessonName, LESSON_PREFIX } from "@/lib/memory/lesson";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * What NaviSoul actually remembers, counted.
 *
 * The Privacy screen listed facts and nothing else, so there was no way to
 * tell whether a skill had really been stored or a conversation had really
 * synced — which is exactly the doubt the exported chats are full of. This
 * answers it with numbers read from the store rather than a reassurance.
 */
export async function GET(request: Request) {
  const token = getRequestClerkSessionToken(request);
  const userId = token ? await getRequestClerkUserId(request) : null;

  const configured = cloudMemoryConfigured() || factsConfigured() || learnedSkillsConfigured();
  if (!configured || !token || !userId) {
    return NextResponse.json({
      configured,
      signedIn: Boolean(userId),
      chats: 0,
      facts: 0,
      skills: 0,
      lessons: 0,
      skillNames: [] as string[],
      lessonNames: [] as string[]
    });
  }

  /* Three independent reads; one failing costs its own count and nothing
     else, because a zero next to two real numbers is more useful than an
     error card that hides all three. */
  const [chats, facts, skills] = await Promise.all([
    cloudMemoryConfigured() ? listCloudChats(token).catch(() => []) : Promise.resolve([]),
    factsConfigured() ? listFacts(token).catch(() => []) : Promise.resolve([]),
    learnedSkillsConfigured() ? listLearnedSkills(token).catch(() => []) : Promise.resolve([])
  ]);

  /* Taught and self-learned are counted apart because they answer different
     questions. "How many skills have I given it" is about what the user did;
     "what has it worked out on its own" is about what the app did while they
     were not looking, and folding the second into the first makes a number the
     user cannot reconcile with their own memory of teaching it things. */
  const taught = skills.filter((skill) => !isLessonName(skill.name));
  const lessons = skills.filter((skill) => isLessonName(skill.name));

  return NextResponse.json({
    configured: true,
    signedIn: true,
    chats: chats.length,
    facts: facts.length,
    skills: taught.length,
    lessons: lessons.length,
    /* Named, not just counted: "12 skills" invites the same doubt as "saved".
       Seeing the names is what makes it believable. */
    skillNames: taught.slice(0, 40).map((skill) => skill.name),
    /* The prefix is a storage detail; showing it in the UI is noise. */
    lessonNames: lessons.slice(0, 40).map((skill) => skill.name.slice(LESSON_PREFIX.length).trim() || skill.name)
  });
}
