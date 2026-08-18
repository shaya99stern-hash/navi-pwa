import type { CapabilityAuth, CapabilityManifest, CapabilityOperation } from "./manifest";

/**
 * Turning a manifest entry plus some arguments into an actual HTTP request.
 *
 * Kept apart from the tool that calls it, and pure, because this is where the
 * mistakes are. Every one of them produces the same symptom from outside — a
 * 400 or a 404 that reads like the API is broken — and every one is invisible
 * without being able to look at the request that was built:
 *
 *  - a path parameter left as `{id}` in the URL
 *  - a query parameter sent as a header, or the reverse
 *  - a key put in `Authorization` for an API that wanted `X-API-Key`
 *  - an argument the model invented, passed through to a stranger's server
 *
 * So it returns the request rather than sending it, and the tests read it.
 */

export type BuiltRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export type BuildResult =
  | { ok: true; request: BuiltRequest }
  | { ok: false; reason: string };

/**
 * Arguments the model supplied, filtered to what the operation declares.
 *
 * Anything not in the spec is dropped rather than forwarded. A model that
 * invents a parameter is guessing, and passing the guess to somebody else's
 * server turns a local mistake into a remote one — at best a 400, at worst a
 * filter nobody intended. The dropped names are reported so the answer can say
 * what was ignored instead of silently doing something else.
 */
export function partitionArguments(
  operation: CapabilityOperation,
  args: Record<string, unknown>
): { path: Record<string, string>; query: Record<string, string>; headers: Record<string, string>; body?: unknown; dropped: string[] } {
  const path: Record<string, string> = {};
  const query: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const dropped: string[] = [];
  let body: unknown;

  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;

    /* The body is named rather than inferred, because an operation can take
       both a body and parameters and there is no way to tell them apart from
       the shape of the value. */
    if (name === "body") {
      if (operation.body) body = value;
      else dropped.push(name);
      continue;
    }

    const parameter = operation.parameters.find((entry) => entry.name === name);
    if (!parameter) { dropped.push(name); continue; }

    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (parameter.in === "path") path[name] = text;
    else if (parameter.in === "query") query[name] = text;
    else headers[name] = text;
  }

  return { path, query, headers, body, dropped };
}

/** Where the key goes, which the spec said and nothing here guesses. */
function applyAuth(auth: CapabilityAuth, apiKey: string, headers: Record<string, string>, query: URLSearchParams): void {
  if (!apiKey) return;
  switch (auth.kind) {
    case "bearer":
      headers.Authorization = `Bearer ${apiKey}`;
      break;
    case "header":
      headers[auth.name] = auth.prefix ? `${auth.prefix} ${apiKey}` : apiKey;
      break;
    case "query":
      query.set(auth.name, apiKey);
      break;
    case "none":
      break;
  }
}

export function buildRequest(input: {
  manifest: CapabilityManifest;
  operation: CapabilityOperation;
  args: Record<string, unknown>;
  apiKey: string;
}): BuildResult {
  const { manifest, operation, args, apiKey } = input;
  const parts = partitionArguments(operation, args);

  /* Every path parameter must be present, because there is no URL without
     them. Reported by name: "that call failed" sends someone to the API's
     documentation, and "you did not give me `id`" is answerable on the spot. */
  const missing = operation.parameters
    .filter((parameter) => parameter.required && parameter.in === "path" && !(parameter.name in parts.path))
    .map((parameter) => parameter.name);
  if (missing.length) {
    return { ok: false, reason: `Missing required path ${missing.length === 1 ? "parameter" : "parameters"}: ${missing.join(", ")}.` };
  }

  let path = operation.path;
  for (const [name, value] of Object.entries(parts.path)) {
    path = path.replace(new RegExp(`\\{${name}\\}`, "g"), encodeURIComponent(value));
  }
  /* A template left unfilled would be sent literally — `/images/%7Bid%7D` — and
     come back as a 404 that looks like the resource is gone. */
  if (/\{[^}]+\}/.test(path)) {
    return { ok: false, reason: `The path still has unfilled placeholders: ${path}.` };
  }

  let url: URL;
  try {
    url = new URL(`${manifest.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  } catch {
    return { ok: false, reason: `The base URL and path do not form a valid address: ${manifest.baseUrl}${path}` };
  }

  for (const [name, value] of Object.entries(parts.query)) url.searchParams.set(name, value);

  const headers: Record<string, string> = { Accept: "application/json", ...parts.headers };
  applyAuth(manifest.auth, apiKey, headers, url.searchParams);

  const body = parts.body !== undefined ? JSON.stringify(parts.body) : undefined;
  if (body) headers["Content-Type"] = "application/json";

  return {
    ok: true,
    request: { url: url.toString(), method: operation.method, headers, ...(body ? { body } : {}) }
  };
}

/**
 * The request, said out loud, with the credential removed.
 *
 * For the activity line and for anything that gets logged. A key that reaches a
 * log is a key that reaches every copy of that log, and this is the one place
 * that formats a request for a human — so it is the one place that has to
 * remember.
 */
export function describeRequest(request: BuiltRequest, auth: CapabilityAuth): string {
  let shown = request.url;
  if (auth.kind === "query") {
    try {
      const url = new URL(request.url);
      url.searchParams.set(auth.name, "…");
      shown = url.toString();
    } catch {
      /* An address that will not parse is one nothing sent, so there is no key
         in it to hide. */
    }
  }
  return `${request.method} ${shown}`;
}
