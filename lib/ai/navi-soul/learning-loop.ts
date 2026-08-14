/* PATH: lib/ai/navi-soul/learning-loop.ts  — NEW FILE, copy verbatim. */

/**
 * How Navi Soul learns constantly — from what the user feeds it, and from its
 * own missions.
 *
 * Two sources, two disciplines:
 *
 * 1. **Fed content** (`ingestContent`): a pasted article, a page URL, a video
 *    transcript. One engine call extracts durable one-sentence lessons, which
 *    go to the existing learned-skills store — the same store the `learning`
 *    tool group already writes, so nothing invents a second memory. Honesty
 *    about video: nothing here "watches" YouTube — a model reads text. A video
 *    is learnable exactly when its transcript (or a page carrying it) can be
 *    fetched or pasted; when it cannot, this says so instead of pretending.
 *
 * 2. **Its own runs** (`learnFromMission`): lessons mined from a mission
 *    report deterministically — zero tokens — because the report already says
 *    what failed, what was revised, and what ran out of budget. An agent that
 *    pays a model to summarise its own telemetry has not learned thrift.
 *
 * Plus `suggestNewSkills`: lane-0 misses that *look* deterministic are
 * clustered so the owner can see which skills to add next. Discovery of new
 * models stays where it lives (`model-discovery.ts`, the MCP registry) — this
 * module never duplicates it.
 *
 * All I/O is injected, same as the mission loop: the store, the fetcher, and
 * the engine belong to the caller, so this adds no network path, no spending
 * path, and no second source of truth.
 */

export type Lesson = {
  id: string;
  kind: "fact" | "preference" | "procedure" | "correction" | "capability";
  /** One sentence, present tense, useful without its source open. */
  statement: string;
  source: string;
  learnedAt: string;
  confidence: "stated" | "inferred";
};

export type LearningExecutors = {
  /** One routed, preflighted model call — the fast lane is plenty. */
  runEngine: (prompt: string, purpose: "extract") => Promise<string>;
  /** The route's existing web fetch tool. Absent = URLs cannot be read. */
  fetchPage?: (url: string) => Promise<string>;
  /** The existing learned-skills / memory store. Returns how many were kept. */
  storeLessons: (lessons: Lesson[]) => Promise<number>;
  onProgress?: (label: string) => void;
};

export type IngestSource = { kind: "url" | "text" | "transcript"; value: string; title?: string };
export type IngestReport = { lessons: Lesson[]; stored: number; notes: string[] };

const MAX_LESSONS = 8;
const MAX_CONTENT_CHARS = 24_000;
const KINDS = new Set(["fact", "preference", "procedure", "correction", "capability"]);

const lessonId = (): string => `lesson-${crypto.randomUUID()}`;
const now = (): string => new Date().toISOString();

/** Tolerant of fences and prose; strict about what is kept. */
export function parseLessons(reply: string, source: string): Lesson[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const lessons: Lesson[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const statement = typeof record.statement === "string" ? record.statement.trim() : "";
      if (statement.length < 10 || statement.length > 300) continue;
      const key = statement.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lessons.push({
        id: lessonId(),
        kind: KINDS.has(record.kind as string) ? (record.kind as Lesson["kind"]) : "fact",
        statement,
        source,
        learnedAt: now(),
        confidence: record.confidence === "inferred" ? "inferred" : "stated"
      });
      if (lessons.length >= MAX_LESSONS) break;
    }
    return lessons;
  } catch {
    return [];
  }
}

function extractionPrompt(content: string, source: string): string {
  return [
    `Extract the durable lessons from the CONTENT — the things worth remembering after the source is gone.`,
    `Reply with ONLY a JSON array, at most ${MAX_LESSONS} entries, no prose:`,
    `[{"kind": "fact" | "preference" | "procedure" | "correction" | "capability", "statement": "one self-contained present-tense sentence", "confidence": "stated" | "inferred"}]`,
    `Rules: no opinions restated as facts; no duplicates; nothing that is only true today; "stated" only for what the content says outright.`,
    "",
    `SOURCE: ${source}`,
    `CONTENT:\n${content}`
  ].join("\n");
}

const YOUTUBE = /(?:youtube\.com|youtu\.be)/i;

export async function ingestContent(
  source: IngestSource,
  executors: LearningExecutors
): Promise<IngestReport> {
  const progress = executors.onProgress ?? (() => {});
  const notes: string[] = [];
  let content = source.value.trim();
  let label = source.title?.trim() || (source.kind === "url" ? source.value.trim() : "pasted content");

  if (source.kind === "url") {
    if (!executors.fetchPage) {
      return { lessons: [], stored: 0, notes: ["No page fetcher is available on this turn, so the URL could not be read. Paste the content or transcript instead."] };
    }
    progress("Reading the page");
    try {
      content = (await executors.fetchPage(source.value)).trim();
    } catch (error) {
      const why = error instanceof Error ? error.message : "fetch failed";
      return {
        lessons: [], stored: 0,
        notes: [YOUTUBE.test(source.value)
          ? `The video page could not be read (${why}). Navi Soul learns from a video's transcript — open the transcript and paste it here.`
          : `The page could not be read (${why}).`]
      };
    }
  }

  if (content.length < 200) {
    return { lessons: [], stored: 0, notes: ["Too little content to learn from — nothing durable can be extracted from a snippet."] };
  }
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS);
    notes.push("Long content was clipped to its first section; feed the rest separately if the tail matters.");
  }

  progress("Extracting lessons");
  let lessons: Lesson[] = [];
  try {
    lessons = parseLessons(await executors.runEngine(extractionPrompt(content, label), "extract"), label);
  } catch (error) {
    return { lessons: [], stored: 0, notes: [`Extraction failed: ${error instanceof Error ? error.message : "error"}.`] };
  }
  if (!lessons.length) {
    return { lessons: [], stored: 0, notes: ["Nothing durable was found to keep."] };
  }

  progress("Remembering");
  const stored = await executors.storeLessons(lessons);
  return { lessons, stored, notes };
}

/**
 * Lessons from a finished mission, computed with zero tokens.
 * The shape mirrors `MissionReport` without importing it, so the learning
 * layer never depends on the loop's module graph.
 */
export function learnFromMission(mission: {
  status: "complete" | "budget-exhausted" | "failed";
  request: string;
  engineCalls: number;
  verified: boolean | null;
  notes: string[];
  failedSteps: string[];
}): Lesson[] {
  const shape = mission.request.trim().slice(0, 80);
  const lessons: Lesson[] = [];
  const add = (kind: Lesson["kind"], statement: string) =>
    lessons.push({ id: lessonId(), kind, statement, source: "own mission", learnedAt: now(), confidence: "inferred" });

  if (mission.status === "budget-exhausted") {
    add("procedure", `Tasks shaped like "${shape}" exceed ${mission.engineCalls} engine calls; decompose them into fewer, larger steps.`);
  }
  for (const step of mission.failedSteps.slice(0, 3)) {
    add("correction", `The step "${step.slice(0, 60)}" failed in a task shaped like "${shape}"; route that step differently next time.`);
  }
  if (mission.notes.some((note) => /revised/i.test(note))) {
    add("procedure", `First drafts for tasks shaped like "${shape}" fail their own check once; verification is worth its call there.`);
  }
  if (mission.verified === false) {
    add("correction", `The answer for "${shape}" did not pass verification and shipped anyway; treat that shape as needing a stronger lane.`);
  }
  return lessons;
}

/** Ways people hand Navi Soul something to learn. Anchored, like everything. */
const LEARN_ASK = /^\s*(?:please\s+)?(?:learn (?:from )?this|remember (?:this|that)|watch this(?: video)?|study this|read this and remember|add this to your (?:memory|knowledge)|from now on[, ])/i;

export function wantsLearning(request: string): boolean {
  return LEARN_ASK.test(request);
}

/**
 * Which skills to build next, mined from lane-0 misses that look deterministic.
 * Pure string clustering — the owner reads the output; no model is spent on it.
 */
const DETERMINISTIC_SHAPES: Array<{ family: string; pattern: RegExp }> = [
  { family: "conversion", pattern: /^\s*(?:convert\s+)?-?\d[\d.,]*\s*[a-z°/]{1,12}\s+(?:in|to|as)\s+[a-z°/]{1,12}\b/i },
  { family: "calculation", pattern: /^\s*(?:what(?:'s| is)\s+)?(?:the\s+)?(?:average|sum|total|difference|product)\b/i },
  { family: "date-math", pattern: /\b(?:days?|weeks?|months?|years?)\s+(?:between|until|since|from)\b/i },
  { family: "formatting", pattern: /^\s*(?:format|round|pad|truncate)\b\s+-?\d/i },
  { family: "lookup-table", pattern: /^\s*(?:what(?:'s| is)\s+)?(?:the\s+)?(?:area code|country code|currency|capital|abbreviation)\s+(?:of|for)\b/i }
];

export function suggestNewSkills(missedQueries: string[]): Array<{ family: string; count: number; examples: string[] }> {
  const families = new Map<string, string[]>();
  for (const query of missedQueries.slice(0, 500)) {
    const hit = DETERMINISTIC_SHAPES.find((shape) => shape.pattern.test(query));
    if (!hit) continue;
    const bucket = families.get(hit.family) ?? [];
    if (bucket.length < 3) bucket.push(query.slice(0, 80));
    families.set(hit.family, bucket);
  }
  return [...families.entries()]
    .map(([family, examples]) => ({ family, count: missedQueries.filter((query) => DETERMINISTIC_SHAPES.find((shape) => shape.family === family)?.pattern.test(query)).length, examples }))
    .sort((left, right) => right.count - left.count);
}
