import raw from "@/data/skills.json";

export type ExecutorKind = "local" | "mcp";

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  triggers: { keywords: string[]; slash: string };
  executor: { kind: ExecutorKind; ref: string };
  requiresModel: false;
  offline: boolean;
  deps: string[];
}

export interface SkillResult {
  ok: boolean;
  output?: unknown;
  mime?: string;
  error?: string;
}

export type Executor = (
  input: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<SkillResult>;

export const SKILLS = raw as Skill[];

const byId = new Map(SKILLS.map((s) => [s.id, s]));
const bySlash = new Map(SKILLS.map((s) => [s.triggers.slash, s]));

/** Registered implementations. Lazy so an unused skill costs zero bytes. */
const impls = new Map<string, () => Promise<Executor>>();

export function register(id: string, loader: () => Promise<Executor>) {
  impls.set(id, loader);
}

export function isImplemented(id: string): boolean {
  return impls.has(id);
}

export function getSkill(id: string) {
  return byId.get(id);
}

export function resolveSlash(cmd: string) {
  return bySlash.get(cmd.trim().split(/\s+/)[0]);
}

/** Every skill in the catalog is now implemented — the 118 that were names
 *  without code have been removed rather than left as a menu of dead ends.
 *  This still draws from the registry, so the invariant is enforced and not
 *  merely assumed. */
function suggestable(): Skill[] {
  return SKILLS.filter((skill) => impls.has(skill.id));
}

/**
 * Deterministic ranking: exact slash > phrase hit > token overlap.
 * No embeddings, no model call, runs offline in ~1ms over 200 entries.
 */
export function match(query: string, limit = 5): Skill[] {
  const q = query.toLowerCase().trim();
  if (q.startsWith("/")) {
    const typed = q.split(/\s+/)[0];
    const exact = bySlash.get(typed);
    if (exact && impls.has(exact.id)) return [exact];
    // Partway through typing a command, offer what it could still become.
    return suggestable()
      .filter((skill) => skill.triggers.slash.startsWith(typed))
      .slice(0, limit);
  }

  const tokens = new Set(q.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const scored: Array<{ s: Skill; score: number }> = [];

  for (const s of suggestable()) {
    let score = 0;
    for (const kw of s.triggers.keywords) {
      if (q.includes(kw)) score += kw.includes(" ") ? 6 : 4;
    }
    for (const t of tokens) {
      if (s.name.toLowerCase().includes(t)) score += 3;
      if (s.description.toLowerCase().includes(t)) score += 1;
    }
    if (score > 0) scored.push({ s, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, limit)
    .map((x) => x.s);
}

export async function run(
  id: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SkillResult> {
  const skill = byId.get(id);
  if (!skill) return { ok: false, error: `unknown skill: ${id}` };

  // `navigator` is absent on the server, where being unable to reach the
  // network is not something we can conclude from its absence.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (skill.executor.kind === "mcp" && offline) {
    return { ok: false, error: `${skill.name} needs a connection` };
  }
  const loader = impls.get(id);
  if (!loader) return { ok: false, error: `${skill.name} is not built yet` };

  try {
    const fn = await loader();
    return await fn(input, signal);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Skills usable right now, given connectivity. */
export function available(online = true) {
  return SKILLS.filter((s) => (online || s.offline) && impls.has(s.id));
}

export function categories(): Array<{ category: string; skills: Skill[] }> {
  const grouped = new Map<string, Skill[]>();
  for (const skill of suggestable()) {
    const list = grouped.get(skill.category) ?? [];
    list.push(skill);
    grouped.set(skill.category, list);
  }
  return [...grouped.entries()]
    .map(([category, skills]) => ({ category, skills }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
