import { describeMatches, describeOperation, isApproved, searchCapabilities, type AddedCapability } from "@/lib/ai/capabilities/search";
import type { CapabilityOperation } from "@/lib/ai/capabilities/manifest";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The piece that decides whether "any API" means a dozen or thousands ──────
   Tool schemas are prompt budget. The MCP bridge caps at 24 tools for exactly
   that reason, and this app's request-size accounting exists because the system
   prompt is the largest single contributor to a turn. Handing the model every
   operation of every added API would break somewhere around the fortieth
   capability — and would break it by silently trimming something else.

   So the manifests are an index, not a toolset. Two tools exist no matter how
   many APIs are added, and an operation's schema is rendered as text on demand,
   where it costs nothing until it is wanted. */

const op = (over: Partial<CapabilityOperation> = {}): CapabilityOperation => ({
  id: "listImages", method: "GET", path: "/images", summary: "List images.", writes: false, parameters: [], ...over
});

const capability = (
  id: string,
  name: string,
  purpose: string,
  operations: CapabilityOperation[],
  approvedWrites: string[] = []
): AddedCapability => ({
  manifest: { id, name, purpose, baseUrl: `https://${id}.example.com`, auth: { kind: "bearer" }, operations, source: "openapi", discoveredAt: 0 },
  apiKey: "k",
  approvedWrites
});

const imagery = capability("imagery", "Imagery", "Satellite imagery by coordinate.", [
  op({ id: "listImages", summary: "List available satellite images." }),
  op({ id: "deleteImage", method: "DELETE", path: "/images/{id}", summary: "Delete an image.", writes: true,
       parameters: [{ name: "id", in: "path", required: true, description: "The image id.", schema: { type: "string" } }] })
]);
const filings = capability("filings", "County Filings", "Public records and filing deadlines.", [
  op({ id: "searchFilings", summary: "Search filings by name." }),
  op({ id: "createFiling", method: "POST", path: "/filings", summary: "Submit a filing.", writes: true })
]);
const all = [imagery, filings];

/* ── An API is findable by what it is, not only by its endpoint wording ───────
   The API's own name and purpose ride along on every one of its operations, so
   "satellite" finds `listImages` even though that operation says neither word.
   Without it an API is reachable only through the vocabulary its authors used,
   rather than the one the owner has. */

const satellite = searchCapabilities("satellite imagery", all);
check("an api is found by its purpose", satellite[0]?.capabilityId, "imagery");
check("and the operation comes with it", satellite[0]?.operation.id, "listImages");

const byWording = searchCapabilities("filing deadlines", all);
check("and by its own wording too", byWording[0]?.capabilityId, "filings");

/* Relevance is normalised by how much was *asked*, not by how much the
   operation says, so a long summary cannot out-rank a precise match by
   accident. */
check("a precise match outranks a wordy one",
  searchCapabilities("delete image", all)[0]?.operation.id, "deleteImage");

/* At equal relevance the one that changes nothing goes first. If both answer
   the question, the read is the one to try — and the write would stop and ask
   anyway. */
const both = searchCapabilities("filings", all);
check("reads come before writes at equal relevance",
  both.map((match) => match.operation.writes)[0], false);

check("results are capped", searchCapabilities("images filings", all, 1).length, 1);
check("and a coincidence is not a match", searchCapabilities("kubernetes", all), []);
check("an empty query matches nothing", searchCapabilities("   ", all), []);
check("and nothing added matches nothing", searchCapabilities("images", []), []);

/* ── The description carries enough to call it without a second look ───────── */

const described = describeOperation(searchCapabilities("delete image", all)[0], false);
check("the call is addressed by capability and operation", described.includes("imagery.deleteImage"), true);
check("with the method and path", described.includes("DELETE /images/{id}"), true);
check("and the api it belongs to", described.includes("on Imagery"), true);
check("required arguments are named, with their types",
  described.includes("Required: id (path, string) — The image id."), true);
check("and an operation needing none says so",
  describeOperation(searchCapabilities("satellite", all)[0], false).includes("Required: nothing."), true);

/* Said at search time rather than discovered at the call, so the model can
   choose a read when one would do instead of walking into a confirmation. */
check("a write announces itself as one", described.includes("This one changes something"), true);
check("and that it has not been approved", described.includes("has not been approved yet"), true);
check("a read says it only reads",
  describeOperation(searchCapabilities("satellite", all)[0], false).includes("This one only reads."), true);
check("and an approved write says so instead",
  describeOperation(searchCapabilities("delete image", all)[0], true).includes("You have standing approval"), true);

/* ── Ask once, then remember ─────────────────────────────────────────────────
   A read is callable immediately. The first attempt at something that changes
   state asks, and approving it never asks again. Per operation rather than per
   API, because "you may read the calendar" and "you may delete from it" are not
   the same grant. */

check("a read needs no approval", isApproved(imagery, imagery.manifest.operations[0]), true);
check("a write does", isApproved(imagery, imagery.manifest.operations[1]), false);
const granted = capability("imagery", "Imagery", "x", imagery.manifest.operations, ["deleteImage"]);
check("and stops asking once granted", isApproved(granted, granted.manifest.operations[1]), true);
/* Approving one write must not approve the API's other writes. */
check("approval does not spread to another operation",
  isApproved(
    capability("filings", "F", "x", filings.manifest.operations, ["searchFilings"]),
    filings.manifest.operations[1]
  ), false);

/* ── Finding nothing is a next step, not a dead end ───────────────────────── */

const empty = describeMatches("kubernetes", [], all);
check("nothing found says so", /Nothing among the added APIs matches/.test(empty), true);
/* Naming what *is* there lets the owner see at once whether the API they meant
   is missing or merely worded differently from how they asked. */
check("and names what is available instead", empty.includes("Imagery, County Filings"), true);
check("and forbids guessing at an endpoint",
  /rather than guessing at an endpoint that may not exist/.test(empty), true);

check("no APIs at all is its own answer",
  /No APIs have been added to this deployment yet/.test(describeMatches("anything", [], [])), true);

const found = searchCapabilities("satellite imagery", all);
const answer = describeMatches("satellite imagery", found, all);
/* Both of the imagery API's operations surface, and that is the design rather
   than noise: asking about an API is asking what it can do, and its identity
   rides on every one of its operations. The ranking is what separates them. */
check("every operation of the matched api is offered", found.map((match) => match.operation.id), ["listImages", "deleteImage"]);
check("a real answer counts what it found", /2 operations may bear on/.test(answer), true);
check("and the one that changes nothing is offered first", found[0].operation.writes, false);
/* The unrelated API stays out of it, or the index is doing nothing. */
check("and an unrelated api is not dragged in",
  found.some((match) => match.capabilityId === "filings"), false);
check("and says how to call it", /Call one with `call_capability`/.test(answer), true);
check("and forbids inventing one that was not listed",
  /Do not invent an operation that is not listed here/.test(answer), true);
/* The whole point of the index: the answer stays small enough to sit in a turn
   alongside the question, however many APIs are behind it. */
check("and stays small enough to be worth rendering", answer.length < 2_000, true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
