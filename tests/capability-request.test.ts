import { buildRequest, describeRequest, partitionArguments } from "@/lib/ai/capabilities/request";
import type { CapabilityManifest, CapabilityOperation } from "@/lib/ai/capabilities/manifest";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Where the mistakes actually are ─────────────────────────────────────────
   Reading a spec correctly buys nothing if the request built from it is wrong,
   and every way of getting this wrong produces the same symptom from outside: a
   400 or a 404 that reads as though the API is broken. A path parameter left
   as `{id}`, a query sent as a header, a key in `Authorization` for an API that
   wanted `X-API-Key` — all invisible without looking at the request itself.

   So the builder returns the request rather than sending it, and these read it. */

const operation = (over: Partial<CapabilityOperation> = {}): CapabilityOperation => ({
  id: "getImage",
  method: "GET",
  path: "/images/{id}",
  summary: "Fetch an image.",
  writes: false,
  parameters: [
    { name: "id", in: "path", required: true, description: "", schema: { type: "string" } },
    { name: "resolution", in: "query", required: false, description: "", schema: { type: "integer" } },
    { name: "X-Region", in: "header", required: false, description: "", schema: { type: "string" } }
  ],
  ...over
});

const manifest = (over: Partial<CapabilityManifest> = {}): CapabilityManifest => ({
  id: "imagery",
  name: "Imagery",
  purpose: "Satellite imagery.",
  baseUrl: "https://api.example.com/v1",
  auth: { kind: "bearer" },
  operations: [],
  source: "openapi",
  discoveredAt: 0,
  ...over
});

/* ── Each argument goes where the spec says it goes ──────────────────────── */

const built = buildRequest({
  manifest: manifest(),
  operation: operation(),
  args: { id: "abc", resolution: 10, "X-Region": "eu" },
  apiKey: "secret-key"
});

check("a request is built", built.ok, true);
if (!built.ok) { console.log("cannot continue"); process.exit(1); }

check("the path parameter is substituted into the url", built.request.url.startsWith("https://api.example.com/v1/images/abc"), true);
check("the query parameter is a query parameter", new URL(built.request.url).searchParams.get("resolution"), "10");
check("the header parameter is a header", built.request.headers["X-Region"], "eu");
check("and the method comes from the operation", built.request.method, "GET");

/* A path segment is not a query string. Anything with a slash or a space in it
   silently becomes a different URL without this. */
const escaped = buildRequest({
  manifest: manifest(), operation: operation(), args: { id: "a/b c" }, apiKey: ""
});
check("a path value is escaped rather than pasted",
  escaped.ok && escaped.request.url.includes("/images/a%2Fb%20c"), true);

/* ── The key goes where the spec said, and nowhere else ──────────────────────
   Assuming bearer is right often enough to be dangerous: the APIs it is wrong
   for fail with a 401 indistinguishable from a bad key. */

check("a bearer key becomes an Authorization header", built.request.headers.Authorization, "Bearer secret-key");

const headerAuth = buildRequest({
  manifest: manifest({ auth: { kind: "header", name: "X-API-Key" } }),
  operation: operation(), args: { id: "a" }, apiKey: "secret-key"
});
check("a named-header key goes in that header", headerAuth.ok && headerAuth.request.headers["X-API-Key"], "secret-key");
check("and not in Authorization", headerAuth.ok && headerAuth.request.headers.Authorization, undefined);

const queryAuth = buildRequest({
  manifest: manifest({ auth: { kind: "query", name: "api_key" } }),
  operation: operation(), args: { id: "a" }, apiKey: "secret-key"
});
check("a query key goes in the query string",
  queryAuth.ok && new URL(queryAuth.request.url).searchParams.get("api_key"), "secret-key");

const noAuth = buildRequest({
  manifest: manifest({ auth: { kind: "none" } }), operation: operation(), args: { id: "a" }, apiKey: "secret-key"
});
check("an API needing no key is not given one anyway",
  noAuth.ok && noAuth.request.headers.Authorization, undefined);
/* An added capability with no key yet must not send the word "undefined" as a
   credential and then report a puzzling 401. */
check("and no key means no auth header at all",
  (() => {
    const built2 = buildRequest({ manifest: manifest(), operation: operation(), args: { id: "a" }, apiKey: "" });
    return built2.ok && built2.request.headers.Authorization;
  })(), undefined);

/* ── Arguments the model invented are dropped, not forwarded ─────────────────
   A model that invents a parameter is guessing, and passing the guess to
   somebody else's server turns a local mistake into a remote one. */

const partitioned = partitionArguments(operation(), { id: "a", nonsense: "x", resolution: 5 });
check("an undeclared argument is dropped", partitioned.dropped, ["nonsense"]);
check("while the declared ones survive", [Object.keys(partitioned.path), Object.keys(partitioned.query)], [["id"], ["resolution"]]);
check("and it never reaches the url",
  (() => {
    const b = buildRequest({ manifest: manifest(), operation: operation(), args: { id: "a", nonsense: "x" }, apiKey: "" });
    return b.ok && b.request.url.includes("nonsense");
  })(), false);
/* Reported rather than silently discarded, so an answer can say what was
   ignored instead of quietly doing something else. */
check("dropped names are reported", partitioned.dropped.length, 1);

/* Null and undefined are how an optional argument arrives when it was not
   supplied. Sending them as the strings "null" and "undefined" is a filter
   nobody asked for. */
check("null and undefined are omitted rather than stringified",
  partitionArguments(operation(), { id: "a", resolution: null, "X-Region": undefined }),
  { path: { id: "a" }, query: {}, headers: {}, dropped: [] });

/* ── Bodies ──────────────────────────────────────────────────────────────── */

const writing = operation({
  id: "createImage", method: "POST", path: "/images", writes: true,
  parameters: [], body: { type: "object", properties: { name: { type: "string" } } }
});
const posted = buildRequest({ manifest: manifest(), operation: writing, args: { body: { name: "x" } }, apiKey: "k" });
check("a body is serialised as json", posted.ok && posted.request.body, '{"name":"x"}');
check("with the content type that says so", posted.ok && posted.request.headers["Content-Type"], "application/json");
/* An operation that takes no body should not acquire one from a stray argument. */
check("a body sent to an operation that takes none is dropped",
  partitionArguments(operation(), { id: "a", body: { x: 1 } }).dropped, ["body"]);
check("and a GET carries no body", built.request.body, undefined);

/* ── Failures name the thing that is missing ─────────────────────────────────
   "That call failed" sends someone to the API's documentation. "You did not
   give me `id`" is answerable on the spot. */

const noId = buildRequest({ manifest: manifest(), operation: operation(), args: {}, apiKey: "k" });
check("a missing path parameter is refused", noId.ok, false);
check("by name", noId.ok === false && noId.reason, "Missing required path parameter: id.");
check("and plural when there are several",
  (() => {
    const two = operation({
      path: "/a/{x}/{y}",
      parameters: [
        { name: "x", in: "path", required: true, description: "", schema: {} },
        { name: "y", in: "path", required: true, description: "", schema: {} }
      ]
    });
    const result = buildRequest({ manifest: manifest(), operation: two, args: {}, apiKey: "" });
    return result.ok === false && result.reason;
  })(), "Missing required path parameters: x, y.");

/* A template left unfilled would be sent literally — `/images/%7Bid%7D` — and
   come back as a 404 that looks like the resource is gone. */
check("an unfilled placeholder is caught rather than sent",
  (() => {
    const odd = operation({ path: "/a/{x}", parameters: [] });
    const result = buildRequest({ manifest: manifest(), operation: odd, args: {}, apiKey: "" });
    return result.ok === false && /unfilled placeholders/.test(result.reason);
  })(), true);

check("a base url that cannot form an address is refused",
  buildRequest({ manifest: manifest({ baseUrl: "not a url" }), operation: operation(), args: { id: "a" }, apiKey: "" }).ok, false);

/* A base URL with a trailing slash and a path with a leading one must not
   produce a double slash, which some servers treat as a different route. */
check("slashes are not doubled",
  (() => {
    const b = buildRequest({ manifest: manifest({ baseUrl: "https://api.example.com/v1/" }), operation: operation(), args: { id: "a" }, apiKey: "" });
    return b.ok && b.request.url;
  })(), "https://api.example.com/v1/images/a");

/* ── Nothing formats a key into something a person will read ─────────────────
   A key that reaches a log reaches every copy of that log. This is the one
   place that renders a request for a human, so it is the one place that has to
   remember. */

check("a query key is hidden when the request is described",
  describeRequest({ url: "https://api.example.com/v1/images/a?api_key=secret-key", method: "GET", headers: {} }, { kind: "query", name: "api_key" }),
  "GET https://api.example.com/v1/images/a?api_key=%E2%80%A6");
check("a header key was never in the url to hide",
  describeRequest({ url: "https://api.example.com/v1/images/a", method: "GET", headers: { Authorization: "Bearer secret-key" } }, { kind: "bearer" }),
  "GET https://api.example.com/v1/images/a");
check("and the description carries the method",
  describeRequest({ url: "https://a.example/x", method: "DELETE", headers: {} }, { kind: "none" }), "DELETE https://a.example/x");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
