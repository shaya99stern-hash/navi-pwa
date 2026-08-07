import "server-only";

/**
 * Skills NaviSoul has learned and keeps.
 *
 * The failure this replaces is written all through the app's chat history:
 * someone says "learn this page and keep it", NaviSoul answers "I've stored
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

async function request(
  clerkToken: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<unknown> {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return null;

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
    if (!response.ok) return null;
    if (response.status === 204) return "ok";
    return await response.json();
  } catch {
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
): Promise<LearnedSkill | null> {
  const name = skill.name.trim().slice(0, MAX_NAME_CHARS);
  const instructions = skill.instructions.trim().slice(0, MAX_INSTRUCTION_CHARS);
  if (!name || !instructions) return null;

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
  });
  const row = Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
  return row ? toSkill(row) : null;
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
export function learnedSkillsBlock(skills: LearnedSkill[]): string {
  if (!skills.length) return "";
  const lines: string[] = [
    "Skills this user has taught you in past conversations. They are yours: apply them without being reminded whenever they fit the task, and never claim you lack a capability listed here.",
    ""
  ];
  let used = 0;
  for (const skill of skills) {
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
  }
  return lines.join("\n").trim();
}
