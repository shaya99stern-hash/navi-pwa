/* PATH: lib/ai/navi-soul/knowledge-base.ts  — NEW FILE, copy verbatim.
   Replaces src/navisoul-intrinsics/knowledge-base.js, which must be deleted. */

import { NAVI_CONSTITUTION } from "@/lib/ai/navi-constitution";

/**
 * What Navi Soul knows about itself before any prompt is assembled.
 *
 * The file this replaces did not parse. `injectNaviSoulContext` was written as
 * `return [NAVISOUL SYSTEM CONTEXT]\n + Identity: + ...` — bare text where
 * string literals should be — so importing it was a syntax error, which is why
 * nothing in the app imported it and the whole engine was dead code sitting in
 * `src/` while `lib/` did the real work.
 *
 * It also carried its own identity line and its own coding rules, in parallel
 * with `NAVI_CONSTITUTION` and the prompt blocks under `lib/ai/`. Two sources
 * for the same statement is one that will drift, so the constitution is
 * imported rather than restated here.
 */

export const NAVI_SOUL_IDENTITY =
  "You are Navi Soul, the routing and processing engine behind NaviOS. You lead: one entry in the picker, dispatching to whichever engine leads at the job.";

export const NAVI_SOUL_PLATFORM = [
  "NaviOS is a local-first progressive web app. Conversations live in IndexedDB on the user's device.",
  "It is used almost entirely on iPhone. Respect the safe-area insets, the visual viewport when the keyboard is up, and a 44px minimum tap target.",
  "It deploys to Vercel on the edge runtime. Never suggest a Node-only API in a path that runs there, and never print an environment variable's value."
] as const;

export const NAVI_SOUL_PRECISION = [
  "Do arithmetic, unit conversion, date maths, and counting with a tool or not at all. Approximating them is the most common way you are wrong.",
  "State assumptions before working from them, and mark an estimate as an estimate."
] as const;

/**
 * The engine's own preamble.
 *
 * Deliberately short. `app/api/chat/route.ts` assembles the real prompt from
 * `stablePrefix` plus the reference blocks it can afford, in an order tuned so
 * a cached prefix survives — anything long added here is charged to every turn
 * and can push a reference block out. This is identity and platform, nothing more.
 */
export function naviSoulPreamble(): string {
  return [
    NAVI_SOUL_IDENTITY,
    NAVI_CONSTITUTION,
    NAVI_SOUL_PLATFORM.join("\n"),
    NAVI_SOUL_PRECISION.join("\n")
  ].join("\n\n");
}
