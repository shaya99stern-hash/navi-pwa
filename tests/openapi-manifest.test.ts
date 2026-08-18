import { authFrom, baseUrlFrom, parseOpenApi, SPEC_PATHS } from "@/lib/ai/capabilities/openapi";
import { isWrite, MAX_OPERATIONS } from "@/lib/ai/capabilities/manifest";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Adding any API, without writing an adapter for it ───────────────────────
   Every other capability in this app is known at build time: the service
   catalogue is a literal, the tool groups are a literal, and there are exactly
   four connector kinds. One path already escapes that, and the reason is worth
   being exact about — MCP servers work because they describe themselves, and
   `mcp-tools.ts` turns `tools/list` straight into callable tools with no
   adapter code at all.

   An OpenAPI document is that same description in a different spelling, and
   most serious APIs publish one. Reading it needs no model, costs one fetch,
   and is the API's own statement about itself rather than an inference from
   its prose. */

const parse = (document: unknown, specUrl = "https://api.example.com/openapi.json") =>
  parseOpenApi({ document, specUrl, id: "example" });

const minimal = {
  openapi: "3.0.0",
  info: { title: "Imagery API", description: "Satellite imagery by coordinate." },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/images/{id}": {
      get: {
        operationId: "getImage",
        summary: "Fetch one image by id.",
        parameters: [
          { name: "id", in: "path", required: true, description: "The image id.", schema: { type: "string" } },
          { name: "resolution", in: "query", description: "Metres per pixel.", schema: { type: "integer" } }
        ]
      },
      delete: { operationId: "deleteImage", summary: "Delete an image." }
    }
  }
};

const parsed = parse(minimal);
check("a spec becomes a manifest", parsed.ok, true);
if (!parsed.ok) { console.log("cannot continue"); process.exit(1); }
const manifest = parsed.manifest;

check("named from the spec", manifest.name, "Imagery API");
check("with the purpose the API states for itself", manifest.purpose, "Satellite imagery by coordinate.");
check("and marked as coming from a spec rather than a guess", manifest.source, "openapi");
check("both operations are found", manifest.operations.map((operation) => operation.id), ["getImage", "deleteImage"]);
/* `operationId` is what the API's own authors called it and what their docs
   use, so it is the name to keep. */
check("the API's own operation names are kept", manifest.operations[0].id, "getImage");

/* ── Read and write are told apart, because the approval gate depends on it ── */

check("a GET only reads", manifest.operations[0].writes, false);
check("a DELETE writes", manifest.operations[1].writes, true);
check("and so does everything that is not a GET",
  ["POST", "PUT", "PATCH", "DELETE"].every((method) => isWrite(method as "POST")), true);
/* The classification errs toward calling something a write. A GET that mutates
   is a broken API; a POST that does not is merely a wasteful one, and the cost
   of the mistake is one confirmation rather than one irreversible action. */
check("reading is the narrow category, not the wide one", isWrite("GET"), false);

/* ── Parameters keep their real types ────────────────────────────────────── */

const image = manifest.operations[0];
check("every parameter survives", image.parameters.map((parameter) => parameter.name), ["id", "resolution"]);
check("with where it goes", image.parameters.map((parameter) => parameter.in), ["path", "query"]);
check("and its schema, so the model sees the type", image.parameters[1].schema, { type: "integer" });
check("and its description", image.parameters[0].description, "The image id.");
/* A URL cannot be built without its path parameters, and specs get `required`
   wrong on them often enough that the spec is not trusted here. */
const looseRequired = parse({
  openapi: "3.0.0", info: {}, paths: {
    "/a/{id}": { get: { parameters: [{ name: "id", in: "path", schema: { type: "string" } }] } }
  }
});
check("a path parameter is required even when the spec omits it",
  looseRequired.ok && looseRequired.manifest.operations[0].parameters[0].required, true);
/* And a query parameter is not, unless the spec says so — inventing a required
   argument is how a working call gets refused before it is made. */
check("but a query parameter is not required by default",
  image.parameters[1].required, false);

/* Parameters declared once for a whole path apply to every method on it, and
   are the usual home for the identifier in the URL. Dropping them loses exactly
   the argument without which the call cannot be made. */
const shared = parse({
  openapi: "3.0.0", info: {}, paths: {
    "/things/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { operationId: "getThing" },
      patch: { operationId: "patchThing", parameters: [{ name: "force", in: "query", schema: { type: "boolean" } }] }
    }
  }
});
check("path-level parameters reach every method",
  shared.ok && shared.manifest.operations.map((operation) => operation.parameters.map((parameter) => parameter.name)),
  [["id"], ["force", "id"]]);

/* The specification says a method-level parameter overrides a path-level one of
   the same name. Two copies would be sent as two arguments. */
const overridden = parse({
  openapi: "3.0.0", info: {}, paths: {
    "/x/{id}": {
      parameters: [{ name: "id", in: "path", required: true, description: "outer", schema: { type: "string" } }],
      get: { parameters: [{ name: "id", in: "path", required: true, description: "inner", schema: { type: "integer" } }] }
    }
  }
});
check("and are overridden rather than duplicated",
  overridden.ok && overridden.manifest.operations[0].parameters.map((parameter) => parameter.description), ["inner"]);

/* ── References are followed, or the types are lost ──────────────────────────
   Specs of any size put every schema behind a `$ref`. A parser that does not
   resolve them produces parameters whose type is the word "$ref", which reaches
   the model as no type at all — a described API turned back into a guessed one. */

const referenced = parse({
  openapi: "3.0.0",
  info: {},
  paths: {
    "/search": {
      post: {
        operationId: "search",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Query" } } } },
        parameters: [{ $ref: "#/components/parameters/Limit" }]
      }
    }
  },
  components: {
    schemas: { Query: { type: "object", properties: { text: { type: "string" } } } },
    parameters: { Limit: { name: "limit", in: "query", description: "How many.", schema: { type: "integer" } } }
  }
});
check("a referenced body schema is resolved",
  referenced.ok && referenced.manifest.operations[0].body, { type: "object", properties: { text: { type: "string" } } });
check("and a referenced parameter",
  referenced.ok && referenced.manifest.operations[0].parameters.map((parameter) => parameter.name), ["limit"]);
check("keeping its resolved type",
  referenced.ok && referenced.manifest.operations[0].parameters[0].schema, { type: "integer" });

/* One broken pointer in a large spec should cost that one type, not the API. */
const dangling = parse({
  openapi: "3.0.0", info: {}, paths: {
    "/a": { get: { operationId: "a", parameters: [{ name: "q", in: "query", schema: { $ref: "#/components/schemas/Missing" } }] } }
  }
});
check("a reference that goes nowhere does not take the API with it",
  dangling.ok && dangling.manifest.operations[0].parameters[0].name, "q");

/* A spec that references itself must terminate. Recursive schemas are ordinary
   — a comment with replies, a tree node — and a parser that hangs on one hangs
   the request that was reading it. */
const recursive = parse({
  openapi: "3.0.0", info: {}, paths: { "/n": { get: { operationId: "n", parameters: [{ name: "node", in: "query", schema: { $ref: "#/components/schemas/Node" } }] } } },
  components: { schemas: { Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } } } }
});
check("a self-referencing schema terminates", recursive.ok, true);

/* ── Swagger 2.0, because a great deal of the real web is still on it ─────── */

const swagger = parse({
  swagger: "2.0",
  info: { title: "Records" },
  host: "records.example.gov",
  basePath: "/api",
  schemes: ["https"],
  paths: {
    "/filings": {
      post: {
        operationId: "createFiling",
        summary: "File a record.",
        parameters: [{ name: "body", in: "body", schema: { type: "object", properties: { name: { type: "string" } } } }]
      }
    }
  },
  securityDefinitions: { key: { type: "apiKey", name: "X-API-Key", in: "header" } }
});
check("a 2.0 document is read too", swagger.ok, true);
check("its base url is assembled from host, scheme and basePath",
  swagger.ok && swagger.manifest.baseUrl, "https://records.example.gov/api");
/* 2.0 spells the request body as a parameter with `in: "body"`. */
check("and its body parameter is read as a body",
  swagger.ok && swagger.manifest.operations[0].body, { type: "object", properties: { name: { type: "string" } } });
check("which is not also left in the parameter list",
  swagger.ok && swagger.manifest.operations[0].parameters, []);

/* ── Auth is read, not assumed ───────────────────────────────────────────────
   Assuming `Authorization: Bearer` is right often enough to be dangerous: it
   works for most APIs, so the ones it does not work for fail with a 401 that
   looks exactly like a wrong key. */

check("a bearer scheme is recognised",
  authFrom({ components: { securitySchemes: { s: { type: "http", scheme: "bearer" } } } }), { kind: "bearer" });
check("a named header key is recognised",
  authFrom({ components: { securitySchemes: { s: { type: "apiKey", name: "X-API-Key", in: "header" } } } }),
  { kind: "header", name: "X-API-Key" });
check("and a query key, common and worse",
  authFrom({ components: { securitySchemes: { s: { type: "apiKey", name: "api_key", in: "query" } } } }),
  { kind: "query", name: "api_key" });
/* 2.0 spells bearer tokens as an `Authorization` apiKey header, so the name has
   to be inspected rather than the type trusted. */
check("2.0's spelling of a bearer token is not mistaken for a custom header",
  authFrom({ securityDefinitions: { s: { type: "apiKey", name: "Authorization", in: "header" } } }), { kind: "bearer" });
/* OAuth2 needs a flow this app cannot complete from a spec alone. A connector
   that looks configured and cannot authenticate is worse than one that says it
   needs something else. */
check("an oauth2 flow is not half-modelled",
  authFrom({ components: { securitySchemes: { s: { type: "oauth2", flows: {} } } } }), { kind: "none" });
check("an API needing no key says so", authFrom({}), { kind: "none" });
check("the parsed manifest carries the scheme", swagger.ok && swagger.manifest.auth, { kind: "header", name: "X-API-Key" });

/* ── Base URLs ───────────────────────────────────────────────────────────── */

check("a relative server url resolves against where the spec came from",
  baseUrlFrom({ servers: [{ url: "/v2" }] }, "https://api.example.com/openapi.json"), "https://api.example.com/v2");
check("an absolute one is taken as given",
  baseUrlFrom({ servers: [{ url: "https://other.example.com/v1/" }] }, "https://api.example.com/openapi.json"),
  "https://other.example.com/v1");
/* A spec served from an API's own host is describing that host, so its address
   is a good answer when the document does not give one. */
check("a document with no server falls back to its own address",
  baseUrlFrom({}, "https://api.example.com/docs/openapi.json"), "https://api.example.com");
check("and a malformed server url does not lose the API",
  baseUrlFrom({ servers: [{ url: "http://[::bad" }] }, "https://api.example.com/openapi.json"), "https://api.example.com");

/* ── Refusals say which problem it is ────────────────────────────────────────
   "This is not a spec" and "this spec has nothing callable" lead somewhere
   different, and a caller that cannot tell them apart reports both as "that
   did not work". */

check("a non-object is refused", parse("not a spec").ok, false);
check("something with no version field is not treated as a spec",
  parse({ paths: { "/a": { get: {} } } }), { ok: false, reason: "No `openapi` or `swagger` version field, so this is not an OpenAPI document." });
check("a spec with no paths says so",
  parse({ openapi: "3.0.0", info: {} }), { ok: false, reason: "The document declares no paths, so there is nothing to call." });
check("and one with paths but nothing on them says something different",
  parse({ openapi: "3.0.0", info: {}, paths: { "/a": {} } }),
  { ok: false, reason: "The document has paths but no callable operations on them." });

/* ── Bounds ──────────────────────────────────────────────────────────────── */

/* Two operations sharing a name would collide as tools, and the later would
   silently replace the earlier. */
const colliding = parse({
  openapi: "3.0.0", info: {}, paths: {
    "/a": { get: { operationId: "same" }, post: { operationId: "same" } }
  }
});
check("colliding operation names are made distinct",
  colliding.ok && new Set(colliding.manifest.operations.map((operation) => operation.id)).size, 2);

/* An operation with no `operationId` still needs a usable name. */
const unnamed = parse({ openapi: "3.0.0", info: {}, paths: { "/v1/things/{id}": { get: {} } } });
check("an unnamed operation gets a readable one",
  unnamed.ok && unnamed.manifest.operations[0].id, "get_v1_things_id");

/* Large public specs run to hundreds of operations. A manifest is what this app
   can usefully hold and choose between, not a mirror of the document. */
const huge = parse({
  openapi: "3.0.0", info: {},
  paths: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`/p${index}`, { get: { operationId: `op${index}` } }]))
});
check("a very large spec is capped", huge.ok && huge.manifest.operations.length <= MAX_OPERATIONS, true);
check("and still yields a usable manifest", huge.ok && huge.manifest.operations.length > 0, true);

/* A deprecated operation is one the API is asking not to be called. */
const deprecated = parse({
  openapi: "3.0.0", info: {}, paths: { "/old": { get: { operationId: "old", deprecated: true } }, "/new": { get: { operationId: "new" } } }
});
check("deprecated operations are left out",
  deprecated.ok && deprecated.manifest.operations.map((operation) => operation.id), ["new"]);

/* ── Where to look ───────────────────────────────────────────────────────── */

check("the conventional spec locations are tried", SPEC_PATHS.length > 4, true);
check("with the most standard one first", SPEC_PATHS[0], "/openapi.json");
check("and every one is a path rather than a whole url",
  SPEC_PATHS.every((path) => path.startsWith("/")), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
