/**
 * The failure this pins: a truncated artifact used to render as a page
 * displaying its own JSON envelope and escape sequences, because the salvage
 * path saw tags inside the unterminated "html" string and treated the whole
 * thing as markup. Observed live — a Game of Life request came back as
 * `{ "id": "conways-game-of-life", ... "html": "\n\n` on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
function load(path) {
  const source = readFileSync(path, "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "node18" });
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, require_);
  return module.exports;
}

const { recoverArtifactPayload } = load("lib/security/artifacts.ts");

const truncated = `{
  "id": "conways-game-of-life",
  "title": "Conway's Game of Life",
  "kind": "html",
  "height": 600,
  "html": "<!DOCTYPE html>\\n<canvas id=\\"g\\"></canvas>\\n<button>Play</button>\\n<script>const c=1;`;

test("a truncated envelope is reported, not rendered", () => {
  const result = recoverArtifactPayload(truncated);
  assert.equal(result.ok, false, "must not claim success on a cut-off payload");
  assert.match(result.error, /cut off|output limit/i);
});

test("the envelope source never becomes the document", () => {
  const result = recoverArtifactPayload(truncated);
  const rendered = JSON.stringify(result);
  assert.ok(!rendered.includes('\\"id\\": \\"conways'), "the JSON envelope must not survive into a payload");
});

test("malformed-but-complete JSON is still reported rather than painted", () => {
  const broken = `{ "kind": "html", "html": "<div>hi</div>", }}`;
  const result = recoverArtifactPayload(broken);
  if (result.ok) {
    assert.ok(!String(result.payload.html ?? "").includes('"kind"'), "envelope leaked into the document");
  }
});

test("a genuine raw-markup fence still renders", () => {
  const result = recoverArtifactPayload("<div><h1>Hello</h1></div>");
  assert.equal(result.ok, true, "raw markup must still be salvaged");
});

test("a well-formed envelope is unaffected", () => {
  const good = JSON.stringify({ id: "x", title: "X", kind: "html", height: 200, html: "<p>ok</p>" });
  const result = recoverArtifactPayload(good);
  assert.equal(result.ok, true);
  assert.equal(result.payload.title, "X");
});
