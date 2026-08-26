import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const route = readFileSync(join(root, "app/api/capabilities/discover/route.ts"), "utf8");
const sheet = readFileSync(join(root, "app/components/connectors-sheet.tsx"), "utf8");

/* ── Discovery has to happen on the server, and not for tidiness ─────────────
   It is a cross-origin fetch to somebody else's host, and a browser refuses it:
   almost no API sends the CORS headers that would let a page on this origin
   read its own spec. Running it server-side is the only place it can run at
   all — and it means the SSRF guards apply, which is the same posture every
   other outbound fetch here takes for the same reason: the address came from
   outside. */

check("discovery is a route rather than a browser fetch", /export async function POST/.test(route), true);
check("and runs where the guards do", /runtime = "edge"/.test(route), true);
check("behind the same authorisation as every other mutation",
  /await authorizeApiMutation\(request\)/.test(route), true);
check("using the shared discovery, not its own fetching",
  /discoverFromSpec\(\{ baseUrl, id, name/.test(route), true);

/* The credential is deliberately absent from this request. Discovery reads a
   public description; the key is for calling. A route handed a secret it has no
   use for is a secret in one more place. */
check("the route neither takes nor forwards a key", /apiKey/.test(route), false);
/* The compact Connectors redesign no longer spends a permanent row explaining
   where a typed key goes. The behaviour still matters more than the copy: the
   credential must remain in component state and must never travel to the
   discovery endpoint. */
check("the key never reaches the discovery request",
  /body: JSON\.stringify\(\{ baseUrl[^}]*\}\)/.test(sheet) && !/apiKey/.test(sheet.slice(sheet.indexOf("capabilities/discover"), sheet.indexOf("capabilities/discover") + 400)), true);

/* A failure here is where someone decides whether their API is supported at
   all, so it carries what was actually tried. "We could not find a spec" with
   nothing behind it is indistinguishable from not having looked. */
check("a failure returns the attempts", /attempts: found\.attempts/.test(route), true);
check("rendered for a person", /detail: describeAttempts\(found\.attempts\)/.test(route), true);
check("and the screen shows them rather than swallowing them",
  /\{discovery\.detail\}/.test(sheet), true);

/* ── The gap between reading and saving is the whole point ───────────────────
   `found` is a state of its own: the spec has been read and nothing has been
   stored. It is the only moment someone can decline on the strength of what was
   actually found rather than on the promise of it. */

check("reading and saving are separate steps",
  /phase: "found"; manifest: CapabilityManifest/.test(sheet), true);
const foundBranch = sheet.slice(sheet.indexOf('discovery.phase === "found"'));
check("the save button appears only once something was found",
  foundBranch.indexOf("onClick={saveApi}") > 0, true);
check("what was found is counted before it is agreed to",
  /\{discovery\.summary\.operations\} operations · \{discovery\.summary\.reads\} read/.test(sheet), true);
check("with the ones that change things named separately",
  /discovery\.summary\.writes \?/.test(sheet), true);
check("and the counting is done where the spec was read",
  /reads: found\.manifest\.operations\.filter\(\(operation\) => !operation\.writes\)\.length/.test(route), true);
/* Authentication remains a discovery fact even though the compact surface no
   longer renders a dedicated permanent Auth row. That lets expanded/diagnostic
   UI expose it without re-reading the spec, and prevents the information from
   being silently thrown away. */
check("the authentication requirement survives discovery",
  /auth: found\.manifest\.auth\.kind/.test(route) && /auth: string/.test(sheet), true);

/* ── Saving ─────────────────────────────────────────────────────────────── */

check("the manifest lands in preferences", /capabilities: \[/.test(sheet), true);
check("re-adding replaces rather than duplicating",
  /capabilities\.filter\(\(entry\) => entry\?\.manifest\?\.id !== manifest\.id\)/.test(sheet), true);
check("and a fresh manifest starts with no approvals carried over",
  /\{ manifest, apiKey: apiKey\.trim\(\), approvedWrites: \[\] \}/.test(sheet), true);
check("an added API can be removed again", /function removeApi\(id: string\)/.test(sheet), true);
check("added APIs are listed", /capabilities\.map\(/.test(sheet), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
