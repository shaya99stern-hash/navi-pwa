import tasks from "@/evals/tasks.json";
import { authorizeApiMutation } from "@/lib/auth/api";

/**
 * Run the eval set from the phone.
 *
 * The harness in `evals/run.mjs` needs a terminal, which means the app's own
 * quality could only ever be measured from a laptop — so in practice it never
 * was. This is the same task set and the same grading, executed by the
 * deployment against itself, so the answer to "is it actually any good" is a
 * button in Settings rather than a thing to do later.
 *
 * Node runtime, not edge: twelve sequential chat requests need real wall-clock,
 * and the edge ceiling is far too low for it.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

type Task = {
  id: string;
  prompt: string;
  expect: { type: "contains" | "regex"; value: string };
  why: string;
};

type TaskResult = {
  id: string;
  passed: boolean;
  why: string;
  answer: string;
  error?: string;
  ms: number;
};

const TASKS = tasks as Task[];
/** One task must not be able to consume the whole run's budget. */
const TASK_TIMEOUT_MS = 55_000;
/** Leaves room to serialize and return the report before the function is cut. */
const RUN_BUDGET_MS = 260_000;

function grade(task: Task, answer: string): boolean {
  if (task.expect.type === "regex") return new RegExp(task.expect.value, "i").test(answer);
  return answer.toLowerCase().includes(String(task.expect.value).toLowerCase());
}

/** Drain a UI message stream down to just the assistant's text. */
function getTrustedAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL for eval origin.");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_APP_URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use http or https.");
  }

  return parsed.origin;
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as { type?: string; delta?: unknown };
        if (chunk.type === "text-delta" && typeof chunk.delta === "string") text += chunk.delta;
      } catch {
        // A partial frame; the next read completes it.
      }
    }
  }
  return text.trim();
}

async function runTask(options: {
  task: Task;
  origin: string;
  cookie: string;
  withTools: boolean;
  preset: string;
}): Promise<TaskResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
  try {
    const response = await fetch(`${options.origin}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The chat API refuses cross-origin mutations, so present as the app.
        Origin: options.origin,
        ...(options.cookie ? { Cookie: options.cookie } : {})
      },
      body: JSON.stringify({
        id: `eval-${options.task.id}`,
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: options.task.prompt }] }],
        preset: options.preset,
        style: "balanced",
        effort: "medium",
        tools: { web: options.withTools, code: false, artifacts: false },
        connectorAccessMode: "ask",
        connectedMcpServers: []
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        id: options.task.id,
        passed: false,
        why: options.task.why,
        answer: "",
        error: `HTTP ${response.status}`,
        ms: Date.now() - startedAt
      };
    }

    const answer = await readStream(response);
    return {
      id: options.task.id,
      passed: grade(options.task, answer),
      why: options.task.why,
      // Enough to see why it failed, not enough to bloat the report.
      answer: answer.slice(0, 400),
      ms: Date.now() - startedAt
    };
  } catch (error) {
    return {
      id: options.task.id,
      passed: false,
      why: options.task.why,
      answer: "",
      error: error instanceof Error ? error.message : "request failed",
      ms: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  /* Same authorization as any other mutation. Without this the endpoint is a
     public button that spends the owner's provider quota twelve calls at a
     time, which is a denial-of-wallet rather than a feature. */
  const authorizationError = await authorizeApiMutation(request);
  if (authorizationError) return authorizationError;

  const url = new URL(request.url);
  const withTools = url.searchParams.get("tools") !== "off";
  const preset = url.searchParams.get("preset") === "navi-code" ? "navi-code" : "navi-soul";
  const origin = getTrustedAppOrigin();
  /* The run calls the app as itself, so it needs the caller's session — the
     chat route would otherwise refuse every task as unauthenticated. */
  const cookie = request.headers.get("cookie") ?? "";

  const startedAt = Date.now();
  const results: TaskResult[] = [];
  let skipped = 0;

  /* Sequential on purpose. Firing twelve requests at once trips the app's own
     rate limit and measures the limiter instead of the model. */
  for (const task of TASKS) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      skipped += 1;
      continue;
    }
    results.push(await runTask({ task, origin, cookie, withTools, preset }));
  }

  const passed = results.filter((result) => result.passed).length;
  const errored = results.filter((result) => result.error).length;

  return Response.json(
    {
      preset,
      tools: withTools ? "on" : "off",
      total: TASKS.length,
      ran: results.length,
      skipped,
      passed,
      errored,
      /* A run where everything errored scores zero and means nothing — the
         requests never reached a model. Say which it was. */
      meaningful: errored < results.length,
      durationMs: Date.now() - startedAt,
      results
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
