import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { extractOffice } from "../engine/navisoul/lib/documents/office";
import { scrape } from "../lib/skills/impl/scrape";
import { assertFetchableUrl } from "../lib/ai/web-tools";

async function main() {
  const bytes = (path: string) => { const file = readFileSync(path); return Uint8Array.from(file).buffer; };
  const doc = extractOffice(bytes("engine/navisoul/tests/fixtures/sample.docx"), "sample.docx");
  assert.ok(doc.text.length > 0);
  const sheet = extractOffice(bytes("engine/navisoul/tests/fixtures/sample.xlsx"), "sample.xlsx");
  assert.ok(sheet.text.includes("A1:"));
  assert.ok(sheet.warnings.some(warning => warning.includes("not recalculated")));
  const malicious = zipSync({ "word/document.xml": strToU8('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><w:p>&secret;</w:p>') });
  assert.throws(() => extractOffice(Uint8Array.from(malicious).buffer, "bad.docx"), /XML declarations/);
  for (const url of ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/"]) assert.throws(() => assertFetchableUrl(url));
  assert.equal((await scrape({ text: "" })).ok, false);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url, options) => {
    calls++;
    assert.equal(url, "/api/tools/scrape");
    assert.deepEqual(JSON.parse(String(options?.body)), { urls: ["https://example.com"] });
    return Response.json({ results: [{ url: "https://example.com", ok: true, text: "Example Domain" }] });
  }) as typeof fetch;
  try { const result = await scrape({ text: "https://example.com" }); assert.equal(result.ok, true); assert.match(String(result.output), /Example Domain/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
  console.log("Office worker and model-free scraping integration checks passed.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
