import "server-only";

import { isLessonName } from "./lesson";

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
      onFailure?.(response.status === 404
        ? `The cloud memory tables do not exist on this Supabase project — the migration in supabase/migrations has not been applied. (404: ${detail || "not found"})`
        : `Supabase refused the write: ${response.status}${detail ? ` ${detail}` : ""}`);
      return null;
    }
    if (response.status === 204) return "ok";
    return await response.json();
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

  const render = (skill: LearnedSkill) => {
    const header = `### ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`;
    const body = used + skill.instructions.length <= PROMPT_BUDGET_CHARS
      ? skill.instructions
      : skill.instructions.slice(0, Math.max(0, Math.min(PER_SKILL_PROMPT_CHARS, PROMPT_BUDGET_CHARS - used)));
    lines.push(header);
    if (body) {
      lines.push(body + (body.length < skill.instructions.length ? "\n[Clipped for space; the full skill is stored.]" : ""));
      used += body.length;
    }
    lines.push("");
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

  return lines.join("\n").trim();
}
