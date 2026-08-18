import {
  isWrite,
  MAX_OPERATIONS,
  type CapabilityAuth,
  type CapabilityManifest,
  type CapabilityOperation,
  type CapabilityParameter,
  type HttpMethod
} from "./manifest";

/**
 * An OpenAPI document turned into something Navi Soul can call.
 *
 * This is the path that needs no model at all, and it is the reason "add any
 * API" is tractable rather than aspirational. Most serious APIs publish a
 * machine-readable description of every endpoint, its parameters, its auth
 * scheme and its responses — which is exactly what MCP's `tools/list` returns,
 * in a different spelling. Where a spec exists, reading it is strictly better
 * than asking a model to infer the same thing from prose: it is the API's own
 * statement about itself, it is complete, and it costs one fetch.
 *
 * Hand-written and dependency-free on purpose. The edge runtime has a bundle
 * limit and no DOM, and every OpenAPI library worth using is large; the subset
 * that matters here — paths, methods, parameters, bodies, security — is a few
 * hundred lines and is a subset this app can be sure of.
 *
 * Both dialects are handled because both are still everywhere: OpenAPI 3.x, and
 * Swagger 2.0, which is a decade old and still what a great many stable APIs
 * publish. Refusing 2.0 would mean refusing a large share of the real web.
 */

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** How deep a `$ref` chain may go before it is treated as a cycle. */
const MAX_REF_DEPTH = 8;
const MAX_SUMMARY = 300;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Follow local `$ref` pointers so a parameter's real type is visible.
 *
 * Specs of any size put every schema behind a reference, so a parser that does
 * not resolve them produces parameters whose type is the word "$ref" — which
 * reaches the model as no type at all, and turns a described API back into a
 * guessed one.
 *
 * Only same-document references are followed. A remote `$ref` is a second fetch
 * to an address the spec chose, which is a request this app would be making on
 * someone else's instruction — the same reason the fetcher validates redirects.
 * They are left unresolved rather than followed.
 */
function resolveRefs(value: unknown, root: Json, depth = 0): unknown {
  if (depth > MAX_REF_DEPTH) return {};
  if (Array.isArray(value)) return value.map((entry) => resolveRefs(entry, root, depth + 1));

  const object = asObject(value);
  if (!object) return value;

  const ref = asString(object.$ref);
  if (ref.startsWith("#/")) {
    const target = ref.slice(2).split("/").reduce<unknown>(
      (node, segment) => asObject(node)?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")],
      root
    );
    /* A reference that goes nowhere resolves to an empty schema rather than
       throwing: one broken pointer in a large spec should cost that one
       parameter's type, not the whole API. */
    return target === undefined ? {} : resolveRefs(target, root, depth + 1);
  }

  const out: Json = {};
  for (const [key, entry] of Object.entries(object)) out[key] = resolveRefs(entry, root, depth + 1);
  return out;
}

/**
 * The origin and base path every operation hangs off.
 *
 * 3.x puts it in `servers[0].url`, which may be relative to where the spec was
 * fetched from. 2.0 splits it across `schemes`, `host` and `basePath`. Either
 * may be absent, in which case the document's own address is the best available
 * answer — and is usually the right one, since a spec served from an API's own
 * host is describing that host.
 */
export function baseUrlFrom(document: Json, specUrl: string): string {
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = asObject(servers[0]);
  const declared = asString(first?.url);
  if (declared) {
    try {
      return new URL(declared, specUrl).toString().replace(/\/+$/, "");
    } catch {
      /* A malformed server URL falls through to the document's own address,
         which is a worse answer than the spec's and a much better one than
         refusing the API. */
    }
  }

  const host = asString(document.host);
  if (host) {
    const schemes = Array.isArray(document.schemes) ? document.schemes.map(asString) : [];
    const scheme = schemes.includes("https") ? "https" : schemes[0] || "https";
    const basePath = asString(document.basePath);
    return `${scheme}://${host}${basePath}`.replace(/\/+$/, "");
  }

  try {
    const url = new URL(specUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/**
 * How this API expects a key, read from the spec rather than assumed.
 *
 * Assuming `Authorization: Bearer` is right often enough to be dangerous: it
 * works for most APIs, so the ones it does not work for fail with a 401 that
 * looks exactly like a wrong key. The spec says which it is, so it is read.
 *
 * The first usable scheme wins. A spec offering several is offering
 * alternatives, and picking the simplest one this app can actually satisfy —
 * a single key — is more useful than modelling all of them.
 */
export function authFrom(document: Json): CapabilityAuth {
  const schemes = asObject(asObject(document.components)?.securitySchemes)
    ?? asObject(document.securityDefinitions)
    ?? {};

  for (const value of Object.values(schemes)) {
    const scheme = asObject(value);
    if (!scheme) continue;
    const type = asString(scheme.type).toLowerCase();

    if (type === "http" && asString(scheme.scheme).toLowerCase() === "bearer") return { kind: "bearer" };
    /* Swagger 2.0 spells bearer tokens as an `Authorization` apiKey header, so
       the name has to be inspected rather than the type trusted. */
    if (type === "apikey") {
      const name = asString(scheme.name);
      const location = asString(scheme.in).toLowerCase();
      if (!name) continue;
      if (location === "query") return { kind: "query", name };
      if (name.toLowerCase() === "authorization") return { kind: "bearer" };
      return { kind: "header", name };
    }
    /* OAuth2 and OpenID Connect need a flow this app cannot complete on the
       user's behalf from a spec alone. Skipped rather than half-modelled — a
       connector that looks configured and cannot authenticate is worse than one
       that says it needs something else. */
  }

  return { kind: "none" };
}

/** `operationId` when the API's own authors named it; a readable fallback if not. */
function operationId(spec: Json, method: HttpMethod, path: string): string {
  const declared = asString(spec.operationId).trim();
  if (declared) return declared.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
  const slug = path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${method.toLowerCase()}_${slug}`.slice(0, 60);
}

function parametersFrom(raw: unknown, root: Json): CapabilityParameter[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityParameter[] = [];
  for (const entry of raw) {
    const parameter = asObject(resolveRefs(entry, root));
    if (!parameter) continue;
    const name = asString(parameter.name);
    const location = asString(parameter.in).toLowerCase();
    if (!name) continue;
    /* `cookie` and 2.0's `formData`/`body` are not modelled: the first is not
       something this app sets, and the second is handled as a request body. */
    if (location !== "path" && location !== "query" && location !== "header") continue;
    out.push({
      name,
      in: location,
      /* A path parameter is required whether or not the spec says so — the URL
         cannot be built without it. Specs get this wrong often enough to be
         worth not trusting. */
      required: location === "path" || parameter.required === true,
      description: asString(parameter.description).slice(0, MAX_SUMMARY),
      schema: asObject(resolveRefs(parameter.schema, root)) ?? asObject(parameter) ?? {}
    });
  }
  return out;
}

/** The JSON request body schema, from either dialect. */
function bodyFrom(spec: Json, root: Json): Record<string, unknown> | undefined {
  const content = asObject(asObject(resolveRefs(spec.requestBody, root))?.content);
  if (content) {
    const json = asObject(content["application/json"]) ?? asObject(Object.values(content)[0]);
    const schema = asObject(resolveRefs(json?.schema, root));
    if (schema) return schema;
  }
  /* Swagger 2.0: the body is a parameter with `in: "body"`. */
  if (Array.isArray(spec.parameters)) {
    for (const entry of spec.parameters) {
      const parameter = asObject(resolveRefs(entry, root));
      if (asString(parameter?.in).toLowerCase() !== "body") continue;
      const schema = asObject(resolveRefs(parameter?.schema, root));
      if (schema) return schema;
    }
  }
  return undefined;
}

export type ParsedSpec =
  | { ok: true; manifest: CapabilityManifest }
  | { ok: false; reason: string };

/**
 * Read a spec into a manifest, or say why it could not be.
 *
 * A discriminated result rather than a throw or a null, for the same reason
 * `readUrl` returns one: "this document has no paths" and "this is not a spec
 * at all" lead somewhere different, and a caller that cannot tell them apart
 * reports both as "that did not work".
 */
export function parseOpenApi(input: {
  document: unknown;
  specUrl: string;
  id: string;
  name?: string;
}): ParsedSpec {
  const document = asObject(input.document);
  if (!document) return { ok: false, reason: "That is not a JSON object, so it is not an OpenAPI document." };

  const version = asString(document.openapi) || asString(document.swagger);
  if (!version) {
    return { ok: false, reason: "No `openapi` or `swagger` version field, so this is not an OpenAPI document." };
  }

  const paths = asObject(document.paths);
  if (!paths) return { ok: false, reason: "The document declares no paths, so there is nothing to call." };

  const info = asObject(document.info) ?? {};
  const operations: CapabilityOperation[] = [];
  const seen = new Set<string>();

  for (const [path, value] of Object.entries(paths)) {
    const item = asObject(value);
    if (!item) continue;
    /* Parameters declared once for the whole path apply to every method on it,
       and are the usual home for the identifier in the URL. Dropping them loses
       exactly the argument without which the call cannot be made. */
    const shared = parametersFrom(item.parameters, document);

    for (const method of METHODS) {
      const spec = asObject(item[method.toLowerCase()]);
      if (!spec) continue;
      if (spec.deprecated === true) continue;

      let id = operationId(spec, method, path);
      /* Two operations sharing a name would collide as tools, and the later one
         would silently replace the earlier. */
      while (seen.has(id)) id = `${id}_${method.toLowerCase()}`.slice(0, 60);
      seen.add(id);

      const own = parametersFrom(spec.parameters, document);
      const names = new Set(own.map((parameter) => `${parameter.in}:${parameter.name}`));

      operations.push({
        id,
        method,
        path,
        summary: (asString(spec.summary) || asString(spec.description) || `${method} ${path}`).slice(0, MAX_SUMMARY),
        writes: isWrite(method),
        /* Method-level parameters win over path-level ones of the same name,
           which is what the specification requires. */
        parameters: [...own, ...shared.filter((parameter) => !names.has(`${parameter.in}:${parameter.name}`))],
        ...(bodyFrom(spec, document) ? { body: bodyFrom(spec, document) } : {})
      });

      if (operations.length >= MAX_OPERATIONS) break;
    }
    if (operations.length >= MAX_OPERATIONS) break;
  }

  if (!operations.length) {
    return { ok: false, reason: "The document has paths but no callable operations on them." };
  }

  return {
    ok: true,
    manifest: {
      id: input.id,
      name: input.name || asString(info.title) || input.id,
      purpose: (asString(info.description) || asString(info.title) || "").slice(0, MAX_SUMMARY),
      baseUrl: baseUrlFrom(document, input.specUrl),
      auth: authFrom(document),
      operations,
      source: "openapi",
      discoveredAt: Date.now()
    }
  };
}

/**
 * Where a spec usually lives, in the order worth trying.
 *
 * Nothing standardises this, but conventions are strong enough that a handful
 * of guesses finds a spec for a large share of APIs — and each is one cheap
 * request against a host the user just chose to add.
 */
export const SPEC_PATHS: readonly string[] = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/.well-known/openapi.json",
  "/api/openapi.json",
  "/api-docs",
  "/v1/openapi.json",
  "/docs/openapi.json"
];
