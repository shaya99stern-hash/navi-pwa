import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { getProviderAvailability } from "@/lib/ai/providers";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/ai/provider-registry";
import { hasWebSearch, searchProviderName } from "@/lib/ai/web-tools";
import { selfUpdateRepo, selfUpdateToken } from "@/lib/ai/self-update-tools";
import { cloudMemoryConfigured } from "@/lib/memory/cloud";
import { factsConfigured } from "@/lib/memory/facts";
import { learnedSkillsConfigured } from "@/lib/memory/learned-skills";
import { describeSandboxConfigGap } from "@/lib/execution/vercel-sandbox";
import { githubWritesEnabled } from "@/lib/github/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which engine capabilities are actually live, and what each missing one needs.
 *
 * The exported chats are full of NaviSoul guessing at this — announcing it had
 * no code sandbox when one is built in but unconfigured, inventing a
 * SHOW_DEVELOPER flag, naming credentials that do not exist. The app knows the
 * real answer; nothing was surfacing it. Names of variables only: never a
 * value, so this is safe to render on a phone.
 */

type Capability = {
  id: string;
  name: string;
  ready: boolean;
  detail: string;
};

export async function GET(request: Request) {
  /* Behind the same guard as a write: this enumerates the deployment's
     configuration, which is not something to hand to an anonymous caller. */
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  const availability = getProviderAvailability();
  const configuredProviders = PROVIDER_IDS.filter((id) => availability[id]);
  const missingProviders = PROVIDER_IDS.filter((id) => !availability[id]);
  const sandboxGap = describeSandboxConfigGap();
  const repo = selfUpdateRepo();

  const capabilities: Capability[] = [
    {
      id: "models",
      name: "Model providers",
      ready: configuredProviders.length > 0,
      detail: configuredProviders.length
        ? `${configuredProviders.length} configured: ${configuredProviders.map((id) => PROVIDERS[id].label).join(", ")}.${missingProviders.length ? ` Add more with ${missingProviders.map((id) => `${PROVIDERS[id].envHint}_API_KEY`).join(", ")}.` : ""}`
        : "None configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in Vercel."
    },
    {
      id: "search",
      name: "Web research",
      ready: hasWebSearch(),
      detail: hasWebSearch()
        ? `Answering through ${searchProviderName()}.`
        : "Needs TAVILY_API_KEY or EXA_API_KEY in Vercel."
    },
    {
      id: "media",
      name: "Image and audio generation",
      ready: availability.huggingface,
      detail: availability.huggingface
        ? "Available."
        : "Needs HF_TOKEN in Vercel. This is why image generation reports being unavailable."
    },
    {
      id: "sandbox",
      name: "Code sandbox",
      ready: !sandboxGap,
      /* NaviSoul has told this user it has no sandbox at all. It has one; it
         was unconfigured, which is a different sentence with a fix at the end. */
      detail: sandboxGap ?? "Python runs in an isolated Vercel Sandbox. JavaScript runs on-device."
    },
    {
      id: "self-update",
      name: "Self-update engine",
      ready: Boolean(selfUpdateToken()),
      detail: selfUpdateToken()
        ? `NaviSoul can read and commit to ${repo.owner}/${repo.repo}; every commit deploys.`
        : "Needs GITHUB_PAT in Vercel. Without it NaviSoul cannot edit its own source."
    },
    {
      id: "github-writes",
      name: "GitHub writes (your account)",
      ready: githubWritesEnabled(),
      detail: githubWritesEnabled()
        ? "NaviSoul may commit and open pull requests on connected repositories."
        : "Read-only. Set NAVI_GITHUB_ALLOW_WRITES=true in Vercel and reconnect GitHub."
    },
    {
      id: "memory",
      name: "Cloud memory",
      ready: cloudMemoryConfigured() && factsConfigured() && learnedSkillsConfigured(),
      detail: cloudMemoryConfigured()
        ? "Chats, facts, and skills sync to your Supabase project."
        : "Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel."
    }
  ];

  return NextResponse.json({
    capabilities,
    ready: capabilities.filter((capability) => capability.ready).length,
    total: capabilities.length
  }, { headers: { "Cache-Control": "no-store" } });
}
