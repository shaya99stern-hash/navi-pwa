import { searchCapabilities, type AddedCapability } from "@/lib/ai/capabilities/search";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── "It has to know variants of that. It can't be that exact." ──────────────
   The owner's words, describing the gap between how a person asks and how an
   API's authors named things. There were three gaps and all of them were in
   the tokenizer's blind spots.

   The worst: `terms()` strips punctuation *before* splitting on whitespace, so
   `listImages` arrived as the single token `listimages`. The most semantically
   loaded field an operation has was unsearchable — "list images" found nothing
   on an operation literally called `listImages`. */

const api = (operations: Array<{ id: string; method: string; path: string; summary: string; writes?: boolean }>): AddedCapability => ({
  manifest: {
    id: "imagery", name: "Imagery", purpose: "Satellite pictures of places.",
    baseUrl: "https://api.example.com", auth: { kind: "none" },
    operations: operations.map((operation) => ({
      writes: false, parameters: [], ...operation
    })) as never,
    source: "openapi", discoveredAt: 1
  },
  apiKey: "", approvedWrites: []
});

const store = [api([
  { id: "listImages", method: "GET", path: "/v1/images", summary: "Return every image." },
  { id: "removeImage", method: "DELETE", path: "/v1/images/{id}", summary: "Remove one.", writes: true },
  { id: "createReport", method: "POST", path: "/v1/reports", summary: "Start a new report.", writes: true }
])];

const found = (query: string) => searchCapabilities(query, store).map((match) => match.operation.id);

/* ── The identifier itself ─────────────────────────────────────────────────── */
check("an operation is findable by the words in its own name", found("list images").includes("listImages"), true);
/* Somebody who pastes the operation name is asking about that operation — it
   would be strange for the one phrasing guaranteed to be right to be the one
   that fails. */
check("and by its name typed exactly as written", found("listImages").includes("listImages"), true);

/* ── Number ────────────────────────────────────────────────────────────────── */
check("the singular finds the plural", found("image").includes("listImages"), true);
check("and the plural finds the singular", found("images").includes("removeImage"), true);

/* ── Verbs ─────────────────────────────────────────────────────────────────── */
/* The most predictable vocabulary mismatch in the domain: nobody says "remove"
   when they mean to delete something. */
check("delete finds an operation called remove", found("delete an image").includes("removeImage"), true);
check("show finds an operation called list", found("show me the images").includes("listImages"), true);
check("add finds an operation called create", found("add a report").includes("createReport"), true);
/* And the owner's own vocabulary for the thing, not the spec's. */
check("pictures finds images", found("pictures").includes("listImages"), true);

/* ── What must NOT match ─────────────────────────────────────────────────────
   Synonyms expand the index only, never the query. Expanding both sides
   multiplies: every query verb would reach every operation verb, and asking to
   delete something would rank an endpoint that creates things. */
check("deleting does not surface the operation that creates",
  found("delete an image").includes("createReport"), false);
check("and an unrelated question finds nothing at all", found("what is the weather in Tokyo"), []);
check("nor does a word that only looks similar", found("imagine a better world").includes("listImages"), false);

/* ── Reads still come first at equal relevance ─────────────────────────────── */
const both = searchCapabilities("images", store);
check("a read outranks a write when both answer",
  both[0].operation.writes, false);

/* ── The API's own identity still reaches its operations ────────────────────
   The property that was already there and must survive: the name and purpose
   ride on every operation, so an API is findable by what it *is*. */
check("an API is findable by what it is for", found("satellite").length > 0, true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
