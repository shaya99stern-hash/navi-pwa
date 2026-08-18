import { readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactFenceBody, recoverArtifactPayload } from "@/lib/security/artifacts";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The shape from the screenshot ───────────────────────────────────────────
   Asked for an interactive kitchen, the app showed a code block labelled TEXT
   with the word `navi-artifact` sitting on the first line and the payload
   underneath it. The model had opened an *unlabelled* fence and written the
   label inside:

       ```
       navi-artifact
       { "id": "modern-kitchen-artifact", ... }
       ```

   Every alias check reads the fence language, which here was empty, so nothing
   matched and a finished artifact rendered as raw JSON.

   This is the third near-miss shape this file has had to absorb — the contract
   asks for one spelling and free-tier models approximate it. Each one looks, to
   the person who asked for a kitchen, exactly like the app being broken. */

const payload = JSON.stringify({ id: "modern-kitchen-artifact", title: "Modern Kitchen", kind: "html", html: "<!DOCTYPE html><p>k</p>", height: 480 });

check("the canonical fence is an artifact", artifactFenceBody("navi-artifact", payload), payload);
check("the label on its own line inside an unlabelled fence is too",
  artifactFenceBody("", `navi-artifact\n${payload}`), payload);
check("and the label is not left in the payload",
  (artifactFenceBody("", `navi-artifact\n${payload}`) ?? "").startsWith("{"), true);
/* The same family of near-misses the aliases already cover, in the new position. */
check("an aliased label on its own line counts as well",
  artifactFenceBody("", `html-artifact\n${payload}`) !== null, true);

/* ── What must keep rendering as code ────────────────────────────────────────
   The rule that makes the above safe: a bare alias-shaped token, and a body
   that really is a payload. */

check("ordinary code is untouched", artifactFenceBody("ts", "const x = 1;"), null);
check("a json block that is not a payload stays code",
  artifactFenceBody("json", JSON.stringify({ hello: "world" })), null);
/* A first line that merely contains the word is prose, not a label. */
check("a sentence mentioning artifacts is not a label",
  artifactFenceBody("", `// the artifact goes here\n${payload}`), null);
/* An artifact-shaped body under no label at all is still just JSON — without
   the label there is nothing saying it was meant to render. */
check("an unlabelled payload with no label line stays code",
  artifactFenceBody("", payload), null);
check("and a long first line is not treated as a label",
  artifactFenceBody("", `navi-artifact-and-then-some-very-long-trailing-text-here\n${payload}`), null);

/* ── Why the same fix explains the second symptom ────────────────────────────
   The turn also ended mid-stream. A truncated payload has an honest message
   waiting for it — "cut off before it finished" — and it never ran, because
   nothing recognised the fence as an artifact in the first place. The user saw
   broken JSON and no explanation for either problem. */

const cut = `navi-artifact\n{"id":"k","title":"Modern Kitchen","kind":"html","html":"<!DOCTYPE html>\\n<html la`;
const body = artifactFenceBody("", cut);
check("a truncated artifact is still recognised as one", body !== null, true);
const recovered = recoverArtifactPayload((body ?? "").trim());
check("and is reported as cut off rather than as raw JSON",
  !recovered.ok && recovered.error.includes("cut off before it finished"), true);
check("with something the person can act on",
  !recovered.ok && recovered.error.includes("Ask for it again, or for a simpler version"), true);

/* ── One decision, both surfaces ─────────────────────────────────────────────
   The thread and the artifacts list asked "is this an artifact?" separately.
   Two answers to that question is how something renders in the conversation
   and then cannot be found in the list. */

const root = process.cwd();
const renderer = readFileSync(join(root, "app/components/markdown-renderer.tsx"), "utf8");
const sheet = readFileSync(join(root, "app/components/artifacts-sheet.tsx"), "utf8");

check("the renderer asks the shared function",
  /const artifactBody = artifactFenceBody\(language, value\);/.test(renderer), true);
check("the artifacts list asks the same one",
  /const payload = artifactFenceBody\(language, body\);/.test(sheet), true);
check("and neither re-derives it from the parts",
  /isArtifactFenceLanguage|looksLikeArtifactFence/.test(renderer + sheet), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
