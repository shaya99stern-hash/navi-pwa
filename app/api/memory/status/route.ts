import { NextResponse } from "next/server";

import { getRequestClerkSessionToken, getRequestClerkUserId } from "@/lib/auth/session";
import { cloudMemoryConfigured, listCloudChats } from "@/lib/memory/cloud";
import { factsConfigured, listFacts } from "@/lib/memory/facts";
import { learnedSkillsConfigured, listLearnedSkills } from "@/lib/memory/learned-skills";

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
      skillNames: [] as string[]
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

  return NextResponse.json({
    configured: true,
    signedIn: true,
    chats: chats.length,
    facts: facts.length,
    skills: skills.length,
    /* Named, not just counted: "12 skills" invites the same doubt as "saved".
       Seeing the names is what makes it believable. */
    skillNames: skills.slice(0, 40).map((skill) => skill.name)
  });
}
