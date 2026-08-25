import "server-only";

import { isLessonName } from "./lesson";
import { readPostgrestPayload } from "./postgrest-response";

/**
 * Skills Navi Soul has learned and keeps.
 *
 * The failure this replaces is written all through the app's chat history:
 * someone says "learn this page and keep it", Navi Soul answers "I've stored
 * this in my durable memory" — and nothing anywhere stores anything. The next
 * conversation knows none of it. A claim of memory with no memory behind it is
 * the worst kind of bug, because the user only discovers it after relying on
 * it.
 *
 * These rows are that memory. Same contract as facts and chats: PostgREST,
 * the caller's own Clerk token, row-level security in the database, no
 * service role anywhere.
 */

const REQUEST_TIMEOUT_MS = 8_000;
const TABLE = "navi_learned_skills";
const MAX_SKILLS = 40;
const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_INSTRUCTION_CHARS = 24_000;
/** What skill content may cost the prompt, total and per skill. */
const PROMPT_BUDGET_CHARS = 6_000;
const PER_SKILL_PROMPT_CHARS = 1_500;

function isLesson(skill: LearnedSkill): boolean {
  return isLessonName(skill.name);
}

export type LearnedSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  sourceUrl: string | null;
  updatedAt: string;
};

export function learnedSkillsConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

function supabaseUrl(): string | undefined {
  const value = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  return value.startsWith("https://") ? value.replace(/\/+$/, "") : undefined;
}

function supabaseKey(): string | undefined {
  const value = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? ""
  ).trim();
  return value || undefined;
}

/**
 * Why the last write failed, in the caller's words rather than a shrug.
 *
 * `if (!response.ok) return null` threw away the one thing anybody needed.
 * PostgREST says precisely what is wrong — the table does not exist, the JWT
 * has no `sub`, row-level security refused the insert — and all of it was
 * discarded, so `rememberSkill` could only report "no". The model, asked why,
 * did what a model does with a failure it cannot see: it invented a cause. The
 * chat history has it confidently blaming Supabase connectivity, then telling
 * the user their skills "cannot be saved permanently by me in this
 * environment... there is no workaround", which is false — the tool exists and
 * the table is defined. A silent failure became a capability the app denied
 * having.
 */
async function request(
  clerkToken: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
  onFailure?: (reason: string) => void
): Promise<unknown> {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    onFailure?.("Cloud memory is not configured on this deployment (no Supabase URL or key).");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${clerkToken}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      /* 404 on the table is the single likeliest cause and the one nobody can
         guess from "it failed": it means the migration was never applied to
         this project, so every write has always failed and always will until
         it is. Worth naming outright rather than leaving as a status code. */
      /* The two failures worth naming, because neither is guessable from a
         status code and they have completely different fixes.

         404: the tables are not there — the migration was never applied.

         401/403 with the tables present is the more likely one here, and it
         was my own wrong guess for a whole round: the schema is fine, and
         Supabase simply does not trust the Clerk token. `auth.jwt() ->> 'sub'`
         then evaluates to null, every row-level-security policy compares
         against null, and every read and write is refused — which looks
         exactly like a missing table from the outside. The fix is not SQL; it
         is registering Clerk as a third-party auth provider in the Supabase
         project so it will verify Clerk's JWTs. */
      onFailure?.(response.status === 404
        ? `The cloud memory tables do not exist on this Supabase project — the migration in supabase/migrations has not been applied. (404: ${detail || "not found"})`
        : response.status === 401 || response.status === 403
          ? `Supabase rejected the request as unauthorised (${response.status}). The tables exist, so this is almost certainly the Clerk token not being trusted: add Clerk as a third-party auth provider in the Supabase project, or every policy will compare against a null user and refuse everything. (${detail || "no detail"})`
          : `Supabase refused the write: ${response.status}${detail ? ` ${detail}` : ""}`);
      return null;
    }
    return (await readPostgrestPayload(response)) ?? "ok";
  } catch (error) {
    onFailure?.(error instanceof Error && error.name === "AbortError"
      ? "Cloud memory timed out."
      : `Cloud memory could not be reached: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Row = { id: string; name: string; description: string; instructions: string; source_url: string | null; updated_at: string };

function toSkill(row: Row): LearnedSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    sourceUrl: row.source_url,
    updatedAt: row.updated_at
  };
}

/** This person's learned skills, newest first. */
export async function listLearnedSkills(clerkToken: string): Promise<LearnedSkill[]> {
  const rows = await request(
    clerkToken,
    `${TABLE}?select=id,name,description,instructions,source_url,updated_at&order=updated_at.desc&limit=${MAX_SKILLS}`
  );
  return Array.isArray(rows) ? (rows as Row[]).map(toSkill) : [];
}

/** Learn a skill, or refresh it when the name already exists. */
export async function rememberSkill(
  clerkToken: string,
  userId: string,
  skill: { name: string; description?: string; instructions: string; sourceUrl?: string }
): Promise<{ skill: LearnedSkill } | { error: string }> {
  const name = skill.name.trim().slice(0, MAX_NAME_CHARS);
  const instructions = skill.instructions.trim().slice(0, MAX_INSTRUCTION_CHARS);
  if (!name) return { error: "A skill needs a name." };
  if (!instructions) return { error: "A skill needs instructions to store." };

  let failure = "";
  const rows = await request(clerkToken, `${TABLE}?on_conflict=user_id,name`, {
    method: "POST",
    body: {
      user_id: userId,
      name,
      description: (skill.description ?? "").trim().slice(0, MAX_DESCRIPTION_CHARS),
      instructions,
      source_url: skill.sourceUrl?.trim().slice(0, 2_000) || null,
      updated_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=representation"
  }, (reason) => { failure = reason; });
  const row = Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
  if (row) return { skill: toSkill(row) };
  return { error: failure || "The store accepted the request but returned no row." };
}

export async function forgetSkill(clerkToken: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const result = await request(clerkToken, `${TABLE}?id=eq.${id}`, { method: "DELETE" });
  return result !== null;
}

/**
 * Render learned skills for the prompt, inside a budget.
 *
 * Every skill is at least named — a skill the model does not know it has may
 * as well not exist — and instructions are included newest-first until the
 * budget runs out, clipped per skill so one enormous ingestion cannot crowd
 * out the rest.
 */
/**
 * Two kinds of memory, said to be two kinds of memory.
 *
 * A skill and a lesson are different objects even though they share a table. A
 * skill is instruction — the user said "do it this way", and it carries their
 * authority. A lesson is evidence — Navi Soul tried something, watched what
 * happened, and wrote down the conclusion, which carries only as much weight as
 * its own reasoning did.
 *
 * Rendering both under "skills this user has taught you" would have made every
 * self-derived guess look like a standing instruction from the user, which is a
 * short path to Navi Soul defending its own mistaken inference as something it
 * was told. So they are separated here, and each is introduced honestly.
 */
export function learnedSkillsBlock(skills: LearnedSkill[]): string {
  if (!skills.length) return "";

  const taught = skills.filter((skill) => !isLesson(skill));
  const learned = skills.filter(isLesson);
  const lines: string[] = [];
  /* One budget across both sections, not one each — the prompt does not care
     which heading a paragraph sat under. Skills are rendered first so that when
     the budget runs out it is a lesson that gets clipped, not an instruction. */
  let used = 0;
  let omitted = 0;

  /**
   * Enough body to be worth a heading.
   *
   * The bug this replaces: the header was pushed unconditionally and only the
   * body counted against the budget. So forty skills contributed roughly four
   * thousand uncounted characters to a six-thousand-character allowance, and
   * once `used` reached the ceiling the body became an empty string, `if (body)`
   * was false, and the skill rendered as a bare title with no instructions and
   * no clipping notice.
   *
   * That is worse than dropping it. The model reads a capability it is told is
   * "yours, apply it without being reminded", cannot see what it does, and has
   * nothing telling it anything is missing — so it either ignores an
   * instruction the user gave it or invents what the title must have meant. A
   * skill that cannot be shown is now counted and named, never mimed.
   */
  const MIN_BODY_CHARS = 80;

  const render = (skill: LearnedSkill) => {
    const header = `### ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`;
    const room = PROMPT_BUDGET_CHARS - used;
    /* The header costs budget too, which is the whole of the arithmetic error. */
    if (header.length + MIN_BODY_CHARS > room) { omitted += 1; return; }

    const bodyRoom = Math.min(PER_SKILL_PROMPT_CHARS, room - header.length);
    const body = skill.instructions.length <= bodyRoom
      ? skill.instructions
      : skill.instructions.slice(0, bodyRoom);

    lines.push(header);
    lines.push(body + (body.length < skill.instructions.length ? "\n[Clipped for space; the full skill is stored.]" : ""));
    lines.push("");
    used += header.length + body.length;
  };

  if (taught.length) {
    lines.push("Skills this user has taught you in past conversations. They are yours: apply them without being reminded whenever they fit the task, and never claim you lack a capability listed here.", "");
    for (const skill of taught) render(skill);
  }

  if (learned.length) {
    lines.push(
      "What you worked out for yourself in past conversations. These are your own conclusions, not instructions from the user — act on them, but if one is contradicted by what you can see right now, trust what you can see and say so rather than defending the note.",
      ""
    );
    for (const skill of learned) render(skill);
  }

  /* Said rather than hidden. "You have more stored than fits here" is a fact
     the model can act on — by asking, or by not claiming this is everything —
     where a silent truncation just makes the memory look smaller than it is. */
  if (omitted) {
    lines.push(
      `[${omitted} further stored ${omitted === 1 ? "item does" : "items do"} not fit in this turn's memory budget. `
      + `${omitted === 1 ? "It is" : "They are"} kept and may apply; say so rather than claiming the list above is everything you know.]`
    );
  }

  return lines.join("\n").trim();
}
