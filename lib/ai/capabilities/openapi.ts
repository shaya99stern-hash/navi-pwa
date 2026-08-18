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
/**
 * How many `$ref` hops one chain may follow.
 *
 * This is the cycle guard, and it is the only thing that number was ever meant
 * to be: a schema referring to itself, directly or around a loop, is normal in
 * real specs and must terminate rather than recurse forever.
 *
 * It used to be charged for ordinary nesting as well — every object level cost
 * one, whether or not a reference was involved. Eight levels is nothing in a
 * real document: `requestBody.content["application/json"].schema.properties.x`
 * is already five before any schema of substance begins, so a referenced type
 * a little way down silently resolved to `{}`. The model then saw a parameter
 * with no type at all, which is the exact failure `resolveRefs` exists to
 * prevent, arriving through the guard meant to make it safe.
 */
const MAX_REF_HOPS = 8;
/** Absurd nesting is still bounded, well past anything a real spec contains. */
const MAX_NESTING = 40;
/**
 * A ceiling on total resolved nodes.
 *
 * Following references *expands*: one `$ref` repeated across a hundred
 * properties pulls its whole subtree in a hundred times, and a few levels of
 * that multiply. The document is somebody else's and is fetched over the
 * network, so the expansion needs a bound that does not depend on the document
 * being reasonable.
 */
const MAX_RESOLVED_NODES = 20_000;
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
type ResolveBudget = { nodes: number };

function resolveRefs(value: unknown, root: Json, hops = 0, depth = 0, budget: ResolveBudget = { nodes: MAX_RESOLVED_NODES }): unknown {
  /* Three separate limits, because they guard three separate things and one
     counter conflated them. */
  if (hops > MAX_REF_HOPS || depth > MAX_NESTING || budget.nodes <= 0) return {};
  budget.nodes -= 1;

  if (Array.isArray(value)) return value.map((entry) => resolveRefs(entry, root, hops, depth + 1, budget));

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
    return target === undefined ? {} : resolveRefs(target, root, hops + 1, depth + 1, budget);
  }

  const out: Json = {};
  for (const [key, entry] of Object.entries(object)) out[key] = resolveRefs(entry, root, hops, depth + 1, budget);
  return out;
}

/**
 * Follow a `$ref` sitting where a path item should be, and no further.
 *
 * 3.x permits `"/pets": { "$ref": "#/components/pathItems/pets" }`, and
 * generated specs use it to share one definition across several routes.
 * Unresolved, the entry is an object with a single `$ref` key and no methods on
 * it, so the path is skipped — and a spec written that way throughout was
 * refused outright as having no callable operations.
 *
 * Deliberately one shallow hop rather than `resolveRefs` over the whole item.
 * Resolving the entire path item eagerly walks down through every operation,
 * request body and schema in it, and the fields underneath are resolved again
 * on their own terms afterwards — so the work is duplicated, and any limit
 * charged for the walk is spent before the schemas that need it are reached.
 */
function resolvePathItem(value: unknown, root: Json): Json | null {
  let item = asObject(value);
  for (let hop = 0; item && hop < MAX_REF_HOPS; hop += 1) {
    const ref = asString(item.$ref);
    if (!ref.startsWith("#/")) return item;
    const target = ref.slice(2).split("/").reduce<unknown>(
      (node, segment) => asObject(node)?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")],
      root
    );
    item = asObject(target);
  }
  return item;
}

/**
 * Substitute a server URL's `{variables}` with the defaults the spec supplies.
 *
 * 3.x lets a server be a template — `https://{region}.api.example.com/{version}`
 * — with a `variables` map giving each placeholder a default. Left as written,
 * that string becomes a hostname containing braces: `new URL` accepts it, the
 * braces percent-encode in the path, and every later call goes to a host that
 * cannot resolve. The failure surfaces as a network error naming a domain the
 * user never typed, which is a poor clue to a spec-parsing problem.
 *
 * A placeholder with no default cannot be guessed. The template is abandoned
 * rather than sent half-filled, so the caller falls back to the address the
 * spec was actually served from — which is nearly always the right host, and
 * is at least a real one.
 */
function fillServerTemplate(url: string, variables: Json | null): string {
  if (!url.includes("{")) return url;

  let unresolved = false;
  const filled = url.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const value = asString(asObject(variables?.[name])?.default);
    if (!value) { unresolved = true; return whole; }
    return value;
  });
  return unresolved ? "" : filled;
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
  const declared = fillServerTemplate(asString(first?.url), asObject(first?.variables));
  if (declared) {
    try {
      return new URL(declared, specUrl).toString().replace(/\/+$/, "");
    } catch {
      /* A malformed server URL falls through to the document's own address,
         which is a worse answer than the spec's and a much better one than
         refusing the API. */
    }
  }

  const host = asString(document.host).replace(/\/+$/, "");
  if (host) {
    const schemes = Array.isArray(document.schemes) ? document.schemes.map(asString) : [];
    const scheme = schemes.includes("https") ? "https" : schemes[0] || "https";
    /* Normalised rather than concatenated. A `basePath` of "v1" — legal, and
       written that way often enough — produced `https://api.example.comv1`:
       a different host entirely, which fails DNS rather than 404ing, so the
       error names a name the user never typed. */
    const raw = asString(document.basePath).trim();
    const basePath = !raw || raw === "/" ? "" : `/${raw.replace(/^\/+/, "")}`;
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

/**
 * A Swagger 2.0 parameter's type, without the parameter's own bookkeeping.
 *
 * 2.0 puts `type`, `format` and `enum` directly on the parameter rather than
 * inside a `schema`, so the previous fallback handed the *whole parameter* over
 * as the schema. That shipped `name`, `in` and `required` into a JSON Schema as
 * though they were keywords — a model reading it sees an object with a property
 * called "in", and the description of the argument is quietly wrong.
 *
 * Only the keys that are actually schema keywords are carried across.
 */
const LEGACY_SCHEMA_KEYS = [
  "type", "format", "enum", "default", "items", "properties", "pattern",
  "minimum", "maximum", "minLength", "maxLength", "multipleOf", "uniqueItems"
] as const;

function schemaFromLegacy(parameter: Json): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  for (const key of LEGACY_SCHEMA_KEYS) {
    if (parameter[key] !== undefined) schema[key] = parameter[key];
  }
  return schema;
}

/**
 * A name not already taken, without the loop that could never terminate.
 *
 * The previous form was `while (seen.has(id)) id = \`${id}_${method}\`.slice(0, 60)`.
 * At 60 characters the clamp discards exactly what was just appended, so the
 * next iteration tests the same string: two operations whose `operationId`s
 * agree through their first 60 characters spun forever.
 *
 * That is not a theoretical shape. Generated specs — Azure, AWS, anything from
 * a code generator — routinely carry operationIds far past 60 characters, and
 * differ only in a suffix. And the document is fetched from a host the user
 * typed, parsed inside an edge request: an unbounded loop there is a request
 * that never returns, on input this app does not control.
 *
 * The suffix now replaces the tail rather than being appended past the clamp,
 * so each attempt is a genuinely different string and the counter guarantees
 * an end.
 */
const MAX_ID = 60;

function uniqueId(preferred: string, taken: Set<string>): string {
  const base = preferred.slice(0, MAX_ID) || "operation";
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const tail = `_${suffix}`;
    const candidate = `${base.slice(0, MAX_ID - tail.length)}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
  /* A thousand collisions on one name is not a spec worth accommodating, and
     `MAX_OPERATIONS` is 120 — so this is unreachable by construction rather
     than by hope. Returning something unique-enough beats throwing. */
  return `${base.slice(0, MAX_ID - 14)}_${Date.now().toString(36)}`;
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
      schema: asObject(resolveRefs(parameter.schema, root)) ?? schemaFromLegacy(parameter)
    });
  }
  return out;
}

/**
 * The request body schema and how it must be encoded, from either dialect.
 *
 * The encoding is returned rather than assumed. `application/json` is taken
 * when the operation offers it; when it does not, the media type it *does*
 * offer decides, because an endpoint that accepts only form encoding will
 * reject a JSON body with a 400 that reads like a bad argument.
 */
type ParsedBody = { schema: Record<string, unknown>; encoding: "json" | "form" };

function bodyFrom(spec: Json, root: Json): ParsedBody | undefined {
  const content = asObject(asObject(resolveRefs(spec.requestBody, root))?.content);
  if (content) {
    const jsonEntry = asObject(content["application/json"]);
    const [firstType, firstValue] = Object.entries(content)[0] ?? [];
    const mediaType = jsonEntry ? "application/json" : asString(firstType);
    const media = jsonEntry ?? asObject(firstValue);
    const schema = asObject(resolveRefs(media?.schema, root));
    if (schema) {
      return { schema, encoding: mediaType.includes("x-www-form-urlencoded") ? "form" : "json" };
    }
  }
  /* Swagger 2.0: the body is a parameter with `in: "body"`. */
  if (Array.isArray(spec.parameters)) {
    for (const entry of spec.parameters) {
      const parameter = asObject(resolveRefs(entry, root));
      if (asString(parameter?.in).toLowerCase() !== "body") continue;
      const schema = asObject(resolveRefs(parameter?.schema, root));
      /* 2.0 declares body media types in `consumes`, at either scope. */
      if (schema) {
        const consumes = [
          ...(Array.isArray(spec.consumes) ? spec.consumes.map(asString) : []),
          ...(Array.isArray(root.consumes) ? root.consumes.map(asString) : [])
        ];
        const form = consumes.length > 0
          && !consumes.some((type) => type.includes("json"))
          && consumes.some((type) => type.includes("x-www-form-urlencoded"));
        return { schema, encoding: form ? "form" : "json" };
      }
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

  /* Counted separately from what is kept, so the ceiling can be reported
     rather than silently applied. */
  let declared = 0;

  for (const [path, value] of Object.entries(paths)) {
    /* A path item may itself be a `$ref`, which 3.x permits and generated specs
       use to share one definition across several routes. Unresolved, the entry
       is an object with a single `$ref` key and no methods on it — so the path
       was skipped, and a spec where *every* path is written that way was
       refused outright as "no callable operations". */
    const item = resolvePathItem(value, document);
    if (!item) continue;
    /* Parameters declared once for the whole path apply to every method on it,
       and are the usual home for the identifier in the URL. Dropping them loses
       exactly the argument without which the call cannot be made. */
    const shared = parametersFrom(item.parameters, document);

    for (const method of METHODS) {
      const spec = asObject(item[method.toLowerCase()]);
      if (!spec) continue;
      if (spec.deprecated === true) continue;

      /* Counted before the ceiling is applied. The loop used to `break` out of
         both levels on reaching the cap, which meant nothing downstream could
         say how much had been left behind — a 500-operation API quietly became
         a 120-operation one and reported "120 operations" as though that were
         the whole of it. */
      declared += 1;
      if (operations.length >= MAX_OPERATIONS) continue;

      /* Two operations sharing a name would collide as tools, and the later one
         would silently replace the earlier. */
      const id = uniqueId(operationId(spec, method, path), seen);
      seen.add(id);

      const own = parametersFrom(spec.parameters, document);
      const names = new Set(own.map((parameter) => `${parameter.in}:${parameter.name}`));
      /* Once. This resolved every `$ref` in the body twice — the condition and
         the value were separate calls to the same walk. */
      const body = bodyFrom(spec, document);

      operations.push({
        id,
        method,
        path,
        summary: (asString(spec.summary) || asString(spec.description) || `${method} ${path}`).slice(0, MAX_SUMMARY),
        writes: isWrite(method),
        /* Method-level parameters win over path-level ones of the same name,
           which is what the specification requires. */
        parameters: [...own, ...shared.filter((parameter) => !names.has(`${parameter.in}:${parameter.name}`))],
        ...(body ? { body: body.schema } : {}),
        ...(body && body.encoding === "form" ? { bodyEncoding: "form" as const } : {})
      });
    }
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
      discoveredAt: Date.now(),
      ...(declared > operations.length ? { truncated: { declared, kept: operations.length } } : {})
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
