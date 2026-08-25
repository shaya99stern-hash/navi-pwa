import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCapabilities } from "@/lib/ai/capabilities/parse";
import { DEFAULT_PREFERENCES } from "@/lib/chat";
import { buildToolset } from "@/lib/tools/registry";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── A manifest crosses the wire, so none of it is trusted on arrival ────────
   Manifests are discovered on the device, stored in the owner's preferences and
   sent with each request — the same path a custom connector's key already
   takes, and for the same reason: the key stays theirs and the server holds
   nothing.

   The owner is not attacking their own app. But a stored value is one a bug can
   corrupt and a sync can mangle, and these particular fields become an outbound
   request from this server: the host, the method, the path. A manifest with a
   rewritten `baseUrl` is a request this server makes on somebody else's
   instruction, which is the shape every URL guard here exists for. */

const manifest = (over: Record<string, unknown> = {}) => ({
  manifest: {
    id: "imagery", name: "Imagery", purpose: "Satellite imagery.",
    baseUrl: "https://api.example.com/v1", auth: { kind: "bearer" },
    operations: [{ id: "listImages", method: "GET", path: "/images", summary: "List.", writes: false, parameters: [] }],
    source: "openapi", discoveredAt: 1,
    ...over
  },
  apiKey: "k",
  approvedWrites: []
});

check("a well-formed capability survives", parseCapabilities([manifest()]).length, 1);
check("and keeps its base url", parseCapabilities([manifest()])[0].manifest.baseUrl, "https://api.example.com/v1");

/* The guard that matters most. Everything else is tidiness; this one is the
   difference between a request to the API and a request to anywhere. */
check("plain http is refused", parseCapabilities([manifest({ baseUrl: "http://api.example.com" })]).length, 0);
check("and so is a non-url", parseCapabilities([manifest({ baseUrl: "javascript:alert(1)" })]).length, 0);

/* `writes` decides whether the approval gate applies, so taking it as sent
   would let a corrupted manifest mark a DELETE as a read and walk straight past
   the one check that exists to stop it. It is recomputed from the method. */
const lying = parseCapabilities([manifest({
  operations: [{ id: "deleteImage", method: "DELETE", path: "/images/{id}", summary: "Delete.", writes: false, parameters: [] }]
})]);
check("a write claiming to be a read is corrected", lying[0].manifest.operations[0].writes, true);
check("and a genuine read stays one", parseCapabilities([manifest()])[0].manifest.operations[0].writes, false);

/* A method nothing recognises would be sent verbatim as an HTTP verb. */
check("an unknown method drops the operation",
  parseCapabilities([manifest({ operations: [{ id: "x", method: "TRACE", path: "/a", parameters: [] }] })]).length, 0);
check("and a path that is not a path drops it too",
  parseCapabilities([manifest({ operations: [{ id: "x", method: "GET", path: "http://elsewhere.example", parameters: [] }] })]).length, 0);
/* An API with nothing callable is not a capability — offering it puts a name in
   the roster that no search can ever satisfy. */
check("an API with no operations is not offered", parseCapabilities([manifest({ operations: [] })]).length, 0);

/* Two capabilities sharing an id make `call_capability` address an ambiguous
   one, and the later would silently shadow the earlier. */
check("a duplicate id is dropped rather than shadowing", parseCapabilities([manifest(), manifest()]).length, 1);

/* A header name goes verbatim into an outbound request. */
check("an auth header name is held to what a header may contain",
  parseCapabilities([manifest({ auth: { kind: "header", name: "X-Key: injected\\r\\nX-Other" } })])[0].manifest.auth,
  { kind: "none" });
check("while a real one is kept",
  parseCapabilities([manifest({ auth: { kind: "header", name: "X-API-Key" } })])[0].manifest.auth,
  { kind: "header", name: "X-API-Key" });
check("and an unrecognised scheme means no key is sent at all",
  parseCapabilities([manifest({ auth: { kind: "magic" } })])[0].manifest.auth, { kind: "none" });

/* An approval that outlives the operation it was given for is a grant nobody
   can see and nobody remembers making. */
const stale = parseCapabilities([{ ...manifest(), approvedWrites: ["listImages", "deletedLongAgo"] }]);
check("approvals for operations that no longer exist are dropped",
  stale[0].approvedWrites, ["listImages"]);

check("garbage is not a capability", parseCapabilities(["nope", 5, null, {}]).length, 0);
check("and neither is a non-array", parseCapabilities({ manifest: {} }), []);
/* One request must not be able to carry an unbounded payload. */
check("the number carried is capped",
  parseCapabilities(Array.from({ length: 200 }, (_, index) => manifest({ id: `api${index}` }))).length <= 40, true);

/* ── Reaching the toolset ──────────────────────────────────────────────────── */

const policy = { web: false, code: false, artifacts: false };
const withNone = buildToolset({ policy, mode: "chat" } as never);
check("no added APIs means no capability tools",
  Object.keys(withNone).some((name) => name.startsWith("find_capability")), false);

const withOne = buildToolset({ policy, mode: "chat", capabilities: parseCapabilities([manifest()]) } as never);
check("one added API brings the search tool", "find_capability" in withOne, true);
check("and the call tool", "call_capability" in withOne, true);
check("and the approval tool", "approve_capability_write" in withOne, true);
/* The property the index exists to hold: the surface does not grow with the
   number of APIs. */
const withMany = buildToolset({
  policy, mode: "chat",
  capabilities: parseCapabilities(Array.from({ length: 20 }, (_, index) => manifest({ id: `api${index}` })))
} as never);
check("twenty APIs add exactly the same three tools",
  Object.keys(withMany).length - Object.keys(withNone).length, 3);

/* ── Read from the production wiring ───────────────────────────────────────── */

const root = process.cwd();
const readSource = (relative: string) => readFileSync(join(root, relative), "utf8").replace(/\r\n?/g, "\n");
const route = readSource("app/api/chat/route.ts");
const shell = readSource("app/components/app-shell.tsx");

check("the route validates what the device sent", /parseCapabilities\(body\.capabilities\)/.test(route), true);
/* Same gate as the connectors beside them: "ask" means this chat does not reach
   the owner's own services without being asked first. */
check("and an asking chat reaches none of them",
  /connectorAccessMode === "ask" \? \[\] : parseCapabilities\(body\.capabilities\)/.test(route), true);
check("the device sends them", /capabilities: preferences\.capabilities,/.test(shell), true);
check("and they have a home in preferences", DEFAULT_PREFERENCES.capabilities, []);

/* The approval runs on the device because the server cannot ask anyone
   anything mid-generation — and because an unhandled client tool call stalls
   the turn rather than failing it. */
check("the client answers the approval tool",
  /toolCall\.toolName === "approve_capability_write"/.test(shell), true);
check("and the answer is a real dialog rather than a sentence",
  /aria-label="Approve a write"/.test(shell), true);
/* A model saying "may I?" in prose is not a gate — it is a sentence it chose to
   write and could equally choose not to. This holds because the tool call
   cannot return until it is answered. */
check("the tool call waits on the owner",
  /await new Promise<boolean>\(\(resolve\) => \{\n {6}approvalAnswer\.current = resolve;/.test(shell), true);
check("approval is written back to their preferences",
  /approvedWrites: \[\.\.\.new Set\(\[\.\.\.entry\.approvedWrites, operation\.id\]\)\]/.test(shell), true);
/* Declining has to close the loop too, or the model treats a refusal as an
   obstacle to route around. */
check("declining says not to look for another way",
  /Do not ask again in this conversation or look for another way to do it/.test(shell), true);
/* Someone approving without being told it is remembered is approving more than
   they think they are. */
check("and the dialog says approval is remembered",
  /Approving remembers this one operation and never asks about it again/.test(shell), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
