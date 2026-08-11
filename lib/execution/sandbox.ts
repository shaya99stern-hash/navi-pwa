/**
 * Running generated JavaScript, on the device, with nothing it can reach.
 *
 * The single largest accuracy gain available here does not come from a better
 * model: a mid-tier model that can run its code and read the error beats a
 * frontier model guessing. Two repair rounds turn a roughly-60% first-pass rate
 * into roughly 90%.
 *
 * ## Why in the browser
 *
 * A server sandbox was the alternative, and on this stack it cannot be made
 * safe. The edge runtime has no way to isolate a script at all, and Node's `vm`
 * module is explicitly not a security boundary — its own documentation says so.
 * That leaves running untrusted code in the same process as the request
 * handler, which is not a trade worth making for any accuracy gain.
 *
 * A worker is a real boundary. It has its own global scope, no DOM, no access
 * to the page, and can be destroyed from outside while it is still running —
 * which is the only reliable way to stop an infinite loop.
 *
 * ## What is taken away before user code runs
 *
 * Everything that could reach the network, the origin's storage, or more code.
 * The code being run was written by a model, and a model can be talked into
 * writing something hostile by content in its own context — so this is treated
 * as untrusted regardless of where it came from.
 *
 * ## What is deliberately not here
 *
 * Python. Running it in-browser means shipping a multi-megabyte WebAssembly
 * runtime to a phone, which is the wrong trade for a mobile-first app. Recorded
 * in the Version 2.0 backlog rather than half-built.
 */

export type ExecutionResult = {
  ok: boolean;
  /** Anything the code logged, in order, truncated. */
  stdout: string;
  /** The error that ended the run, or an empty string. */
  stderr: string;
  /** Whatever the last expression evaluated to, formatted. */
  value: string;
  durationMs: number;
  /** True when the run was killed for exceeding its wall clock. */
  timedOut: boolean;
};

export const EXECUTION_TIMEOUT_MS = 5_000;
/** Enough to see what happened, short enough not to flood a conversation. */
const MAX_OUTPUT_CHARS = 4_000;
const MAX_LOG_LINES = 200;

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated at ${MAX_OUTPUT_CHARS} characters.`;
}

/**
 * Where the worker is fetched from, and why it is a route rather than a Blob.
 *
 * A worker built from a `blob:` URL inherits the *owner document's* CSP. This
 * app's `script-src` deliberately has no `'unsafe-eval'` outside development,
 * so the `new Function` below threw `EvalError` on every production run: code
 * execution worked on a laptop and could never work on the deployed site.
 *
 * A worker fetched from a real URL is governed by the CSP on *its own*
 * response instead. Serving it from `/sandbox-worker` lets that one response
 * carry `'unsafe-eval'` while the page keeps a strict policy, so permission to
 * compile a string exists only inside the thing whose job is compiling
 * strings.
 */
export const SANDBOX_WORKER_PATH = "/sandbox-worker";

/**
 * The worker body, as source, so the route handler and the Blob fallback are
 * served from one definition rather than drifting apart.
 */
export const WORKER_SOURCE = `
self.onmessage = function (event) {
  var code = event.data && event.data.code;
  var logs = [];
  var started = Date.now();

  /* Taken away before the code is compiled, not after. Anything that could
     reach the network, persist to the origin, or pull in more code. */
  var forbidden = [
    "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
    "indexedDB", "localStorage", "sessionStorage", "caches", "crypto",
    "navigator", "location", "Notification", "BroadcastChannel", "SharedWorker",
    "Worker", "postMessage", "close"
  ];
  var post = self.postMessage.bind(self);
  for (var index = 0; index < forbidden.length; index += 1) {
    try { delete self[forbidden[index]]; } catch (error) { /* non-configurable */ }
    try { self[forbidden[index]] = undefined; } catch (error) { /* frozen */ }
  }

  var format = function (value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
  };

  var record = function (level) {
    return function () {
      if (logs.length >= ${MAX_LOG_LINES}) return;
      var parts = [];
      for (var index = 0; index < arguments.length; index += 1) parts.push(format(arguments[index]));
      logs.push((level === "log" ? "" : "[" + level + "] ") + parts.join(" "));
    };
  };

  var console = { log: record("log"), info: record("log"), warn: record("warn"), error: record("error"), debug: record("log") };

  var value = "";
  var stderr = "";
  try {
    /* Indirect construction so the code cannot see this scope's variables.
       An ordinary eval would give it access to \`logs\`, \`post\`, and the rest. */
    var run = new Function("console", '"use strict";\\n' + code);
    var returned = run(console);
    if (returned !== undefined) value = format(returned);
  } catch (error) {
    stderr = error && error.stack ? String(error.stack) : format(error);
  }

  post({
    stdout: logs.join("\\n"),
    stderr: stderr,
    value: value,
    durationMs: Date.now() - started
  });
};
`;

/**
 * Run a snippet and come back with what happened.
 *
 * Never rejects. A sandbox that throws would make the caller's repair loop
 * handle two different failure shapes for the same event — "the code was wrong"
 * — so every outcome, including being killed for running too long, arrives as a
 * result with `ok: false` and something readable in `stderr`.
 */
export function runInSandbox(code: string, timeoutMs = EXECUTION_TIMEOUT_MS): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const settle = (result: ExecutionResult) => resolve(result);

    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
      settle({ ok: false, stdout: "", stderr: "Code execution is not available in this browser.", value: "", durationMs: 0, timedOut: false });
      return;
    }

    let url = "";
    let worker: Worker | null = null;
    let finished = false;

    const cleanup = () => {
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
    };

    /* Terminating from outside is the only thing that reliably stops a `while
       (true)`. A cooperative check inside the worker never gets a turn. */
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      settle({
        ok: false,
        stdout: "",
        stderr: `Execution was stopped after ${timeoutMs}ms. The code did not finish — check for a loop that never ends.`,
        value: "",
        durationMs: timeoutMs,
        timedOut: true
      });
    }, timeoutMs);

    try {
      /* The route first, because only its response can carry 'unsafe-eval'.
         The Blob is kept as a fallback for `next dev`, offline starts before
         the service worker has the route cached, and any deployment serving
         this file without the header. */
      try {
        worker = new Worker(SANDBOX_WORKER_PATH);
      } catch {
        url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        worker = new Worker(url);
      }

      worker.onmessage = (event: MessageEvent) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        const data = (event.data ?? {}) as { stdout?: string; stderr?: string; value?: string; durationMs?: number };
        const stderr = String(data.stderr ?? "");
        settle({
          ok: !stderr,
          stdout: truncate(String(data.stdout ?? "")),
          stderr: truncate(stderr),
          value: truncate(String(data.value ?? "")),
          durationMs: Number(data.durationMs) || Date.now() - started,
          timedOut: false
        });
      };

      worker.onerror = (event: ErrorEvent) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        settle({
          ok: false,
          stdout: "",
          // A syntax error never reaches onmessage — it fails at compile time.
          stderr: event.message || "The code could not be compiled.",
          value: "",
          durationMs: Date.now() - started,
          timedOut: false
        });
      };

      worker.postMessage({ code });
    } catch (error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      settle({
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Code execution could not start.",
        value: "",
        durationMs: Date.now() - started,
        timedOut: false
      });
    }
  });
}

/**
 * How a run is described back to the model.
 *
 * Failure is stated first and plainly. A model reading its own output decides
 * what to do next from the first thing it sees, and burying the error under the
 * logs is how a broken run gets reported as a working one.
 */
export function describeResult(result: ExecutionResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? "The code ran successfully." : "The code failed.");
  if (result.stderr) lines.push(`Error:\n${result.stderr}`);
  /* Said at the point of failure, not only in the system prompt, because this
     is the text the model is reading when it decides what to do next. Left to
     itself it computes the answer by hand and presents it as the result —
     observed producing a 62-character "SHA-256" and crediting it to a
     cryptographic library it never called. */
  if (!result.ok) {
    lines.push(
      "Do not supply the result this code would have produced. You do not know it. Report that execution failed and why. If a built-in skill covers the task — /sha-hash, /hmac-sign, /expression-evaluate, /base64-encode-decode and the rest run on-device and do not need this sandbox — use that instead. Otherwise give the user the exact code to run themselves."
    );
  }
  if (result.stdout) lines.push(`Output:\n${result.stdout}`);
  if (result.value) lines.push(`Returned:\n${result.value}`);
  if (!result.stdout && !result.value && result.ok) lines.push("It produced no output. Return a value or log something to show the result.");
  return lines.join("\n\n");
}
