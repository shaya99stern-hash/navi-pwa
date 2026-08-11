#!/usr/bin/env tsx
/**
 * Which provider is actually better at what.
 *
 * The routing matrix in `docs/orchestration-blueprint.md` has one row built and
 * the rest unbuilt, deliberately: asserting that DeepSeek beats Cerebras at
 * code, or Groq beats Mistral at intent, without measuring it would be an
 * invented number dressed as engineering. Those rows decide where every hard
 * request goes, so a wrong guess is expensive and completely silent — the app
 * keeps working, slightly worse, forever.
 *
 * This measures them instead. It calls each configured provider **directly**,
 * not through `/api/chat`, because the question is which model is better and
 * the app's own routing is exactly the variable that has to be held still.
 *
 *   npm run bench                      # every configured provider
 *   npm run bench -- --kind code       # one capability
 *   npm run bench -- --runs 3          # repeat, for latency spread
 *
 * Needs the provider keys in the environment. Providers without a key are
 * skipped and named, rather than scored zero — an unconfigured provider is not
 * a bad one.
 */
import { PROVIDERS, providerApiKey } from "../lib/ai/provider-registry";
import { ROUTES } from "../lib/ai/providers";
import type { ProviderName } from "../lib/ai/types";

type Check =
  | { type: "contains"; value: string }
  | { type: "regex"; value: string }
  | { type: "includes-all"; value: string[] };

type Task = {
  id: string;
  /** Which capability this is evidence about. */
  kind: "mechanical" | "code" | "reasoning" | "long-context" | "intent";
  prompt: string;
  expect: Check;
  /** Why this task discriminates. A task everything passes measures nothing. */
  why: string;
};

/**
 * Tasks with checkable answers, chosen to discriminate rather than to flatter.
 *
 * Every one has a single defensible answer a grader can verify without
 * judgement. That rules out "write a good function" — the moment scoring needs
 * an opinion, the benchmark measures the grader.
 */
const TASKS: Task[] = [
  {
    id: "mech-json",
    kind: "mechanical",
    prompt: 'Reformat this JSON with 2-space indentation. Output only the JSON.\n{"b":2,"a":[1,{"c":3}]}',
    expect: { type: "includes-all", value: ['"b": 2', '"a": ['] },
    why: "Pure transformation. Any model should pass; the discriminator is latency, not correctness."
  },
  {
    id: "mech-extract",
    kind: "mechanical",
    prompt: "From this line return only the email address, nothing else:\nContact: Ada Lovelace <ada@example.org> (primary)",
    expect: { type: "contains", value: "ada@example.org" },
    why: "Extraction with a distractor. Chatty models append commentary and fail 'nothing else'."
  },
  {
    id: "code-fix",
    kind: "code",
    prompt: "This JavaScript returns undefined for an empty array. Fix it so it returns 0, and output only the corrected function.\nfunction sum(xs){return xs.reduce((a,b)=>a+b)}",
    expect: { type: "includes-all", value: ["reduce", "0"] },
    why: "A real defect with one conventional fix: the missing reduce initial value."
  },
  {
    id: "code-boundary",
    kind: "code",
    prompt: "What does this print, and why? Answer with the number first.\nconst a=[1,2,3]; console.log(a.slice(-1)[0] + a.length);",
    expect: { type: "contains", value: "6" },
    why: "Requires actually evaluating two operations, not recognising a pattern."
  },
  {
    id: "reason-constraint",
    kind: "reasoning",
    prompt: "A train leaves at 14:35 and the journey takes 2 hours 50 minutes. There is a 25 minute delay. What time does it arrive? Give the time in 24-hour format.",
    expect: { type: "contains", value: "18:00" },
    why: "Multi-step arithmetic over a base-60 boundary, where approximation is silently wrong."
  },
  {
    id: "reason-elimination",
    kind: "reasoning",
    prompt: "Three boxes: one holds apples, one oranges, one both. Every label is wrong. You draw one fruit from the box labelled 'both' and it is an apple. What does the box labelled 'oranges' contain? Answer in one word or two.",
    expect: { type: "regex", value: "both|apples? and oranges" },
    why: "Classic elimination. Models that pattern-match the puzzle without reasoning answer 'apples'."
  },
  {
    id: "intent-classify",
    kind: "intent",
    prompt: 'Classify this request as exactly one of: code, research, reasoning, general. Reply with the single word only.\n"my build fails with ENOENT after upgrading node"',
    expect: { type: "regex", value: "^\\s*code\\s*$" },
    why: "Routing decisions sit on the path of every request. Verbosity here is a defect."
  },
  {
    id: "long-needle",
    kind: "long-context",
    prompt: `Below is a list. Return only the value assigned to KEY_417.\n${
      Array.from({ length: 600 }, (_, i) => `KEY_${i} = ${i === 417 ? "MARKER_XQ7" : `v${i}`}`).join("\n")
    }`,
    expect: { type: "contains", value: "MARKER_XQ7" },
    why: "Retrieval from the middle of a long input, where context windows quietly truncate."
  }
];

/** The route each provider is actually used through, so this benchmarks reality. */
const BENCH_ROUTES: Partial<Record<ProviderName, { model: string }>> = {
  groq: ROUTES.groqReasoning,
  cerebras: ROUTES.cerebrasLarge,
  gemini: ROUTES.geminiSynthesis,
  deepseek: ROUTES.deepseekFlash,
  mistral: ROUTES.mistralBalanced,
  openrouter: ROUTES.openRouterReasoning,
  together: ROUTES.togetherReasoning,
  huggingface: ROUTES.hfGptOss
};

function graded(text: string, expect: Check): boolean {
  const body = text.trim();
  if (expect.type === "contains") return body.toLowerCase().includes(expect.value.toLowerCase());
  if (expect.type === "regex") return new RegExp(expect.value, "i").test(body);
  return expect.value.every((part) => body.includes(part));
}

type Outcome = { ok: boolean; ms: number; note?: string };

async function runOne(provider: ProviderName, model: string, key: string, task: Task): Promise<Outcome> {
  const adapter = PROVIDERS[provider];
  const base = adapter.baseURL.replace(/\/+$/, "");
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: task.prompt }],
        max_tokens: 700,
        temperature: 0
      }),
      signal: controller.signal
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 120);
      return { ok: false, ms, note: `HTTP ${response.status} ${detail}` };
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: graded(text, task.expect), ms };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      note: error instanceof Error && error.name === "AbortError" ? "timed out" : "unreachable"
    };
  } finally {
    clearTimeout(timer);
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };
  const onlyKind = flag("kind", "");
  const runs = Math.max(1, Number(flag("runs", "1")) || 1);

  const available: Array<{ provider: ProviderName; model: string; key: string }> = [];
  const skipped: string[] = [];
  for (const [name, route] of Object.entries(BENCH_ROUTES) as Array<[ProviderName, { model: string }]>) {
    const key = providerApiKey(PROVIDERS[name]);
    if (!key) { skipped.push(PROVIDERS[name].label); continue; }
    if (!route.model) { skipped.push(`${PROVIDERS[name].label} (no model configured)`); continue; }
    available.push({ provider: name, model: route.model, key });
  }

  if (!available.length) {
    console.error("No provider keys are set, so there is nothing to measure.");
    console.error("Set at least two — a benchmark of one provider cannot compare anything.");
    process.exit(1);
  }

  const tasks = onlyKind ? TASKS.filter((task) => task.kind === onlyKind) : TASKS;
  const kinds = [...new Set(tasks.map((task) => task.kind))];

  console.log(`Benchmarking ${available.length} provider(s) over ${tasks.length} task(s), ${runs} run(s) each.`);
  if (skipped.length) console.log(`Skipped, no key: ${skipped.join(", ")}`);
  console.log("");

  /* provider -> kind -> outcomes */
  const results = new Map<ProviderName, Map<string, Outcome[]>>();

  for (const entry of available) {
    const byKind = new Map<string, Outcome[]>();
    results.set(entry.provider, byKind);
    for (const task of tasks) {
      for (let run = 0; run < runs; run += 1) {
        const outcome = await runOne(entry.provider, entry.model, entry.key, task);
        byKind.set(task.kind, [...(byKind.get(task.kind) ?? []), outcome]);
        process.stdout.write(outcome.ok ? "." : "x");
      }
    }
    process.stdout.write(` ${PROVIDERS[entry.provider].label}\n`);
  }

  console.log("");
  console.log("Correct / attempted, and median latency:");
  console.log("");
  const header = ["provider".padEnd(14), ...kinds.map((kind) => kind.padEnd(18))].join("");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const entry of available) {
    const byKind = results.get(entry.provider)!;
    const cells = kinds.map((kind) => {
      const outcomes = byKind.get(kind) ?? [];
      if (!outcomes.length) return "—".padEnd(18);
      const correct = outcomes.filter((outcome) => outcome.ok).length;
      return `${correct}/${outcomes.length} ${median(outcomes.map((o) => o.ms))}ms`.padEnd(18);
    });
    console.log([PROVIDERS[entry.provider].label.padEnd(14), ...cells].join(""));
  }

  /* Failures worth reading: a provider that scored zero because its key is
     rejected is a configuration problem, not a capability finding, and
     reporting the two the same way is how a benchmark misleads. */
  const notes = new Set<string>();
  for (const [provider, byKind] of results) {
    for (const outcomes of byKind.values()) {
      for (const outcome of outcomes) {
        if (outcome.note) notes.add(`${PROVIDERS[provider].label}: ${outcome.note}`);
      }
    }
  }
  if (notes.size) {
    console.log("");
    console.log("Errors (not capability findings — check these before trusting a zero):");
    for (const note of notes) console.log(`  ${note}`);
  }

  console.log("");
  console.log("Read this as evidence, not a verdict. One run per task is a sample of one;");
  console.log("use --runs 3 or more before moving a routing rule, and re-run after any");
  console.log("provider changes the model behind its id.");
}

void main();
