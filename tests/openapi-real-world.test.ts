import { buildRequest } from "@/lib/ai/capabilities/request";
import { baseUrlFrom, parseOpenApi } from "@/lib/ai/capabilities/openapi";
import { parseCapabilities } from "@/lib/ai/capabilities/parse";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Specs as they are actually written ──────────────────────────────────────
   The manifest parser was built against clean, hand-written documents and had
   never met one in the wild — this sandbox's egress proxy refuses external
   hosts, so nothing here could be fetched to try. These fixtures reproduce the
   shapes real specs use instead: generated operationIds, templated servers,
   Swagger 2.0 holdovers, path items behind references, form-encoded bodies.

   Every case below was a defect when it was written. */

const SPEC_URL = "https://api.example.com/openapi.json";
const parse = (document: unknown) => parseOpenApi({ document, specUrl: SPEC_URL, id: "x" });

/* ── The one that hung ───────────────────────────────────────────────────────
   Disambiguation was `while (seen.has(id)) id = \`${id}_${method}\`.slice(0, 60)`.
   At 60 characters the clamp discards exactly what was just appended, so the
   next test sees the same string and the loop never ends. Two operationIds
   agreeing through 60 characters is ordinary in generated specs.

   This test reaching its assertion at all is the assertion: before the fix it
   never returned. */
const prefix = "listAllOfTheThingsThatThisEnterpriseServiceKnowsAboutInDetail";
const clashing = parse({
  openapi: "3.0.0", info: { title: "Generated" },
  paths: {
    "/one": { get: { operationId: `${prefix}ForRegionOne`, responses: {} } },
    "/two": { get: { operationId: `${prefix}ForRegionTwo`, responses: {} } }
  }
});
check("operation ids that collide after clamping still terminate", clashing.ok, true);
const ids = clashing.ok ? clashing.manifest.operations.map((operation) => operation.id) : [];
check("both operations survive", ids.length, 2);
check("under distinct names", new Set(ids).size, 2);
check("and neither exceeds the clamp", ids.every((id) => id.length <= 60), true);

/* ── Templated servers ───────────────────────────────────────────────────────
   `https://{region}.api.example.com` left as written becomes a hostname
   containing braces: `new URL` accepts it, and every call goes to a host that
   cannot resolve — surfacing as a DNS error naming a domain nobody typed. */
check("a templated server url is filled from its defaults",
  baseUrlFrom({ servers: [{ url: "https://{region}.api.example.com/{version}", variables: { region: { default: "us-east-1" }, version: { default: "v2" } } }] } as never, SPEC_URL),
  "https://us-east-1.api.example.com/v2");
/* A placeholder with no default cannot be guessed, and half-filling it is
   worse than not using it: the spec's own address is at least a real host. */
check("a placeholder with no default abandons the template",
  baseUrlFrom({ servers: [{ url: "https://{region}.api.example.com" }] } as never, SPEC_URL),
  "https://api.example.com");
check("a relative server url resolves against where the spec was served",
  baseUrlFrom({ servers: [{ url: "/api/v3" }] } as never, SPEC_URL), "https://api.example.com/api/v3");

/* ── Swagger 2.0 ─────────────────────────────────────────────────────────── */

/* `basePath: "v1"` is legal and written that way often. Concatenated raw it
   produced `https://api.example.comv1` — a different host, so the request fails
   DNS rather than returning a 404 that would have explained itself. */
check("a basePath without a leading slash is normalised",
  baseUrlFrom({ host: "api.example.com", basePath: "v1", schemes: ["https"] } as never, SPEC_URL),
  "https://api.example.com/v1");
check("and a host with a trailing slash does not double it",
  baseUrlFrom({ host: "api.example.com/", basePath: "/v1", schemes: ["https"] } as never, SPEC_URL),
  "https://api.example.com/v1");
check("https is preferred when the spec offers both",
  baseUrlFrom({ host: "api.example.com", schemes: ["http", "https"] } as never, SPEC_URL),
  "https://api.example.com");

/* 2.0 puts `type` on the parameter itself rather than in a `schema`, so the
   fallback handed the whole parameter over — shipping `name`, `in` and
   `required` into a JSON Schema as if they were keywords. */
const legacy = parse({
  swagger: "2.0", info: { title: "Legacy" }, host: "api.example.com", basePath: "/v1", schemes: ["https"],
  paths: { "/items": { get: { operationId: "listItems", parameters: [
    { name: "limit", in: "query", type: "integer", description: "How many.", required: false }
  ], responses: {} } } }
});
check("a 2.0 parameter's schema carries its type",
  legacy.ok && legacy.manifest.operations[0].parameters[0].schema, { type: "integer" });
check("and not the parameter's own bookkeeping",
  legacy.ok && Object.keys(legacy.manifest.operations[0].parameters[0].schema).some((key) => key === "name" || key === "in"), false);
check("while the description still reaches the model",
  legacy.ok && legacy.manifest.operations[0].parameters[0].description, "How many.");

/* ── Path items behind a reference ───────────────────────────────────────── */

const referenced = parse({
  openapi: "3.1.0", info: { title: "Shared" },
  paths: { "/pets": { $ref: "#/components/pathItems/pets" } },
  components: { pathItems: { pets: { get: { operationId: "listPets", responses: {} } } } }
});
check("a path item behind a $ref is followed", referenced.ok, true);
check("and its operation is callable",
  referenced.ok && referenced.manifest.operations.map((operation) => `${operation.method} ${operation.path}`), ["GET /pets"]);
/* The whole API used to be refused when every path was written this way — not
   one path skipped, the entire document rejected as having nothing callable. */
check("a spec written entirely that way is not refused",
  parse({
    openapi: "3.1.0", info: { title: "Shared" },
    paths: { "/a": { $ref: "#/components/pathItems/a" }, "/b": { $ref: "#/components/pathItems/a" } },
    components: { pathItems: { a: { get: { operationId: "read", responses: {} } } } }
  }).ok, true);
/* A pointer that goes nowhere costs that path, not the document. */
check("a path item pointing at nothing costs only that path",
  parse({
    openapi: "3.1.0", info: { title: "Shared" },
    paths: { "/gone": { $ref: "#/components/pathItems/missing" }, "/here": { get: { operationId: "read", responses: {} } } }
  }).ok, true);

/* ── Reference resolution depth ──────────────────────────────────────────────
   One counter used to guard cycles *and* ordinary nesting, charging both to the
   same budget of 8. But `requestBody.content["application/json"].schema.
   properties.x` is already five levels before any real schema starts, so a
   referenced type a little way down resolved to `{}` — the model saw a
   parameter with no type, which is exactly what resolving references is for. */

const deep = parse({
  openapi: "3.0.0", info: { title: "Deep" },
  paths: { "/search": { post: {
    operationId: "search",
    requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Query" } } } },
    responses: {}
  } } },
  components: { schemas: {
    Query: { type: "object", properties: { filter: { $ref: "#/components/schemas/Filter" } } },
    Filter: { type: "object", properties: { range: { $ref: "#/components/schemas/Range" } } },
    Range: { type: "object", properties: { from: { type: "string", format: "date-time" } } }
  } }
});
check("a type three references down still resolves", deep.ok, true);
check("and arrives with its real type rather than as an empty object",
  deep.ok && (deep.manifest.operations[0].body as never as { properties: { filter: { properties: { range: { properties: { from: { format: string } } } } } } })
    .properties.filter.properties.range.properties.from.format,
  "date-time");

/* A schema that refers to itself is ordinary — a comment with replies, a
   directory with subdirectories — and must terminate rather than recurse. */
const cyclic = parse({
  openapi: "3.0.0", info: { title: "Cyclic" },
  paths: { "/tree": { post: {
    operationId: "putTree",
    requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } },
    responses: {}
  } } },
  components: { schemas: {
    Node: { type: "object", properties: { name: { type: "string" }, child: { $ref: "#/components/schemas/Node" } } }
  } }
});
check("a self-referencing schema terminates", cyclic.ok, true);
check("keeping the levels it did resolve",
  cyclic.ok && (cyclic.manifest.operations[0].body as never as { properties: { name: { type: string } } }).properties.name.type, "string");

/* ── Request bodies that are not JSON ────────────────────────────────────────
   OAuth token endpoints and older infrastructure accept only form encoding.
   Sent JSON they answer 400, which reads as a bad argument and sends whoever
   is debugging it to look at the arguments rather than the envelope. */

const form = parse({
  openapi: "3.0.0", info: { title: "Token" },
  paths: { "/token": { post: {
    operationId: "getToken",
    requestBody: { content: { "application/x-www-form-urlencoded": { schema: { type: "object", properties: { grant_type: { type: "string" } } } } } },
    responses: {}
  } } }
});
check("a form-encoded body is recognised as one",
  form.ok && form.manifest.operations[0].bodyEncoding, "form");
const json = parse({
  openapi: "3.0.0", info: { title: "T" },
  paths: { "/a": { post: { operationId: "a", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: {} } } }
});
/* Absent rather than "json": the field exists to mark the exception, and a
   value on every operation would make the common case carry the cost of the
   rare one on every stored manifest. */
check("while a JSON body carries no encoding at all",
  json.ok && "bodyEncoding" in json.manifest.operations[0], false);

/* An operation offering both takes JSON: it is what this app builds best, and
   the media type is listed first here to prove the choice is by preference
   rather than by whichever key happened to come first. */
const both = parse({
  openapi: "3.0.0", info: { title: "T" },
  paths: { "/a": { post: { operationId: "a", requestBody: { content: {
    "application/x-www-form-urlencoded": { schema: { type: "object", properties: { a: { type: "string" } } } },
    "application/json": { schema: { type: "object", properties: { b: { type: "string" } } } }
  } }, responses: {} } } }
});
check("an operation offering both is sent JSON",
  both.ok && "bodyEncoding" in both.manifest.operations[0], false);
check("and takes the JSON schema rather than the one listed first",
  both.ok && both.manifest.operations[0].body, { type: "object", properties: { b: { type: "string" } } });

/* The encoding has to survive into the request, or recording it changed
   nothing. */
const formManifest = form.ok ? form.manifest : null;
const built = formManifest
  ? buildRequest({ manifest: formManifest, operation: formManifest.operations[0], args: { body: { grant_type: "client_credentials" } }, apiKey: "" })
  : null;
check("a form body is encoded as form fields",
  built?.ok ? built.request.body : null, "grant_type=client_credentials");
check("and declared as form in the header",
  built?.ok ? built.request.headers["Content-Type"] : null, "application/x-www-form-urlencoded");

/* ── Large specs ─────────────────────────────────────────────────────────────
   A 500-operation API quietly became a 120-operation one and reported "120
   operations" as though that were all of it. */

const many = parse({
  openapi: "3.0.0", info: { title: "Huge" },
  paths: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [
    `/thing${index}`, { get: { operationId: `read${index}`, responses: {} } }
  ]))
});
check("a large spec is capped", many.ok && many.manifest.operations.length, 120);
check("and says how much it left behind",
  many.ok && many.manifest.truncated, { declared: 300, kept: 120 });
check("a spec inside the cap claims no truncation",
  legacy.ok && "truncated" in legacy.manifest, false);

/* ── What survives the wire ──────────────────────────────────────────────────
   `bodyEncoding` decides a Content-Type header on an outbound request, so it is
   validated on arrival like every other field that becomes part of one. */

const stored = (over: Record<string, unknown>) => parseCapabilities([{
  manifest: {
    id: "t", name: "T", purpose: "T.", baseUrl: "https://api.example.com", auth: { kind: "none" },
    operations: [{ id: "send", method: "POST", path: "/send", summary: "Send.", writes: true, parameters: [], body: { type: "object" }, ...over }],
    source: "openapi", discoveredAt: 1
  },
  apiKey: "", approvedWrites: []
}]);
check("a form encoding survives being stored", stored({ bodyEncoding: "form" })[0].manifest.operations[0].bodyEncoding, "form");
check("and anything else is dropped rather than becoming a header",
  "bodyEncoding" in stored({ bodyEncoding: "text/html; charset=x" })[0].manifest.operations[0], false);

/* ── Truncation has to reach a person ────────────────────────────────────────
   A count recorded on a manifest that nothing renders is not honesty, it is
   bookkeeping. */

const { readFileSync } = require("node:fs") as typeof import("node:fs");
const { join } = require("node:path") as typeof import("node:path");
const root = process.cwd();

check("the discovery route reports what was left behind",
  /found\.manifest\.truncated \? \{ truncated: found\.manifest\.truncated \}/.test(readFileSync(join(root, "app/api/capabilities/discover/route.ts"), "utf8")), true);
check("the screen says so before the API is saved",
  /This API describes \{discovery\.summary\.truncated\.declared\} operations/.test(readFileSync(join(root, "app/components/connectors-sheet.tsx"), "utf8")), true);
/* And the model, because "no match" on a clipped API has a second cause: the
   operation may exist and simply not have been kept. */
check("and a failed search says the operation may exist but not be held",
  /not the same as "not offered by that API"/.test(readFileSync(join(root, "lib/ai/capabilities/search.ts"), "utf8")), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
