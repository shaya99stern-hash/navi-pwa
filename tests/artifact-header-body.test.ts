/**
 * The header+body artifact shape, and the legacy envelope beside it.
 *
 * The old contract asked for a whole HTML document inside a JSON string. The
 * model did that correctly — a stored payload proves it — and still failed,
 * because escaping a document into JSON roughly doubles its token count and
 * the reply ran past the per-minute output ceiling mid-string. It ends,
 * exactly, at `box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);`.
 *
 * So the fix is about cost, not correctness: same document, half the tokens,
 * nothing to escape. What these assertions protect is the *other* half — ten
 * chats already in the cloud hold legacy-shaped artifacts, and they have to
 * keep rendering.
 */
import { artifactFenceBody, looksLikeArtifactFence, recoverArtifactPayload, splitHeaderArtifact } from "@/lib/security/artifacts";
import { createArtifactGate } from "@/lib/ai/artifact-gate";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};
const ok = (result: ReturnType<typeof recoverArtifactPayload>) => (result.ok ? result.payload : null);

/* ── The shape the contract now asks for ─────────────────────────────────── */

const header = `{"id":"tip-calc","title":"Tip calculator","kind":"html","height":420}`;
const body = `<div class="wrap">
  <input id="bill" type="number" placeholder="Bill amount">
  <button id="go">Calculate</button>
</div>
<script>
  document.getElementById('go').addEventListener('click', () => { document.title = "done"; });
</script>`;
const headerArtifact = `${header}\n---\n${body}`;

const split = splitHeaderArtifact(headerArtifact);
check("splits at the delimiter", split?.header, header);
check("body survives verbatim", split?.content, body);

const tip = ok(recoverArtifactPayload(headerArtifact));
check("header+body recovers", Boolean(tip), true);
check("id comes from the header", tip?.id, "tip-calc");
check("title comes from the header", tip?.title, "Tip calculator");
check("kind comes from the header", tip?.kind, "html");
check("height comes from the header", tip?.height, 420);
check("content is the raw body", tip?.html, body);

/* The whole point: unescaped double quotes in attributes, which is what made
   the JSON envelope expensive. `class="wrap"` reaching the payload with its
   quotes intact is the token saving, made visible. */
check("attribute quotes are never escaped", tip?.html?.includes('class="wrap"'), true);
check("no JSON escapes leaked into the document", tip?.html?.includes("\\n"), false);

/* ── A literal `---` inside the document ─────────────────────────────────── */

/* The delimiter is the *first* dashed line and only the first, so a horizontal
   rule, a YAML block, or a markdown divider in the body is content rather than
   a second split point. Getting this wrong would truncate any document that
   contains one. */
const withRule = `{"id":"doc","title":"Notes","kind":"html"}\n---\n<h1>Notes</h1>\n---\n<p>After the rule</p>`;
const ruled = ok(recoverArtifactPayload(withRule));
check("a later --- stays in the body", ruled?.html, "<h1>Notes</h1>\n---\n<p>After the rule</p>");
check("nothing after the second delimiter is lost", ruled?.html?.includes("After the rule"), true);

/* ── SVG through the same door ───────────────────────────────────────────── */

const svgArtifact = `{"id":"chart","title":"Chart","kind":"svg","height":300}\n---\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;
const chart = ok(recoverArtifactPayload(svgArtifact));
check("svg kind is honoured", chart?.kind, "svg");
check("svg content is raw", chart?.svg?.startsWith("<svg"), true);

/* A header that mislabels an SVG document as html is a mistake, not an
   instruction — the document itself is the better evidence of what it is. */
const mislabelled = ok(recoverArtifactPayload(`{"id":"m","title":"M","kind":"html"}\n---\n<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>`));
check("a mislabelled svg is still an svg", mislabelled?.kind, "svg");

/* ── The legacy envelope still renders ───────────────────────────────────── */

/* Ten chats in the cloud hold this shape. A reader that stopped understanding
   it would delete working artifacts from history. */
const legacy = JSON.stringify({ id: "legacy-card", title: "Legacy card", kind: "html", height: 380, html: '<div class="card">Old shape</div>' });
const old = ok(recoverArtifactPayload(legacy));
check("legacy envelope still recovers", Boolean(old), true);
check("legacy id survives", old?.id, "legacy-card");
check("legacy content survives", old?.html, '<div class="card">Old shape</div>');
check("legacy height survives", old?.height, 380);

/* A legacy envelope whose document happens to contain a dashed line must not
   be mistaken for a header. The discriminator is whether the object already
   carries the content. */
const legacyWithRule = JSON.stringify({ id: "r", title: "R", kind: "html", html: "<hr>" }) + "\n---\n";
check("an envelope carrying content is not a header", splitHeaderArtifact(legacyWithRule), null);

/* ── Truncation still says so ────────────────────────────────────────────── */

/* Cut inside the header, before the delimiter ever arrived. There is no split
   to make, so this falls to the JSON path — where the honest message lives. */
const cutInHeader = `{"id":"tip-calc","title":"Tip calc`;
const headerCut = recoverArtifactPayload(cutInHeader);
check("a header cut short does not render", headerCut.ok, false);
check("a header cut short is reported as cut off", headerCut.ok === false && headerCut.error.includes("cut off"), true);

/* Cut inside the body. This is the case the new shape improves: the document
   is incomplete, but what arrived is real markup, so the reader shows the part
   that exists instead of dropping the whole artifact. A sandboxed browser
   closes the open tags; a JSON envelope in the same state produced nothing at
   all. */
const cutInBody = `{"id":"garden","title":"Garden","kind":"html"}\n---\n<div class="plot"><style>.plot{box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);`;
const bodyCut = ok(recoverArtifactPayload(cutInBody));
check("a body cut short still renders what arrived", Boolean(bodyCut), true);
check("the partial document is kept, not blanked", bodyCut?.html?.includes("box-shadow"), true);

/* A header with nothing after the delimiter is not an artifact — there is no
   document to show, and claiming otherwise renders an empty card. */
check("an empty body is not an artifact", splitHeaderArtifact(`{"id":"x","title":"X","kind":"html"}\n---\n`), null);
check("an empty body is not recovered", recoverArtifactPayload(`{"id":"x","title":"X","kind":"html"}\n---\n   `).ok, false);

/* ── Recognition, so the shape survives a mislabelled fence ──────────────── */

/* Models reach for `artifact` and `html-artifact` as often as the canonical
   label. Recognition has to cover the new shape too, or a correct payload
   renders as a wall of raw markup under the wrong fence. */
check("the header shape reads as an artifact fence", looksLikeArtifactFence(headerArtifact), true);
check("an alias fence carrying the header shape is claimed", artifactFenceBody("artifact", headerArtifact), headerArtifact);
check("the canonical fence is claimed as always", artifactFenceBody("navi-artifact", headerArtifact), headerArtifact);
/* And an ordinary code block is still an ordinary code block. */
check("plain json is not swallowed", artifactFenceBody("json", `{"a":1}`), null);
check("plain html is not swallowed", artifactFenceBody("html", "<p>hi</p>"), null);

/* ── Through the streaming gate ──────────────────────────────────────────── */

/* The gate is what the reader actually sees. It normalises every shape back to
   a canonical JSON fence before release, so the renderer never learns there
   are two contracts — which is why the header shape needed no renderer change
   at all. */
const streamThrough = (chunks: string[]): string => {
  const gate = createArtifactGate();
  let out = "";
  for (const chunk of chunks) out += gate.push(chunk);
  return out + gate.flush();
};

const streamed = streamThrough([`Here you go:\n\`\`\`navi-artifact\n${headerArtifact}\n\`\`\`\nDone.`]);
check("a header+body artifact reaches the reader", streamed.includes("navi-artifact"), true);
check("it is normalised to the canonical fence", streamed.includes('"id":"tip-calc"'), true);
check("no removal notice for a good artifact", streamed.includes("removed"), false);
check("surrounding prose is untouched", streamed.startsWith("Here you go:") && streamed.endsWith("Done."), true);
/* Split character by character, because a fence marker straddling two deltas
   is how this gate has broken before. */
check("it survives arriving one character at a time", streamThrough(`\`\`\`navi-artifact\n${headerArtifact}\n\`\`\``.split("")).includes('"id":"tip-calc"'), true);

/* The failure the owner kept reporting: the reply ran out of budget and the
   fence never closed. A JSON envelope in that state is unsalvageable and still
   is. A header+body one is not. */
const cutOff = createArtifactGate();
cutOff.push(`\`\`\`navi-artifact\n{"id":"garden","title":"Garden walkthrough","kind":"html"}\n---\n<div class="plot"><h1>The garden</h1><style>.plot{box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);`);
const salvaged = cutOff.flush();
check("an unclosed header+body artifact is salvaged", salvaged.includes("navi-artifact"), true);
check("the salvage says it was cut off", salvaged.includes("cut off"), true);
check("the salvage is not the old removal notice", salvaged.includes("removed an incomplete"), false);
check("the part that arrived is in the payload", salvaged.includes("The garden"), true);

/* A header with almost nothing under it is not worth a card. Below the floor
   the honest notice is still the right answer. */
const barelyStarted = createArtifactGate();
barelyStarted.push(`\`\`\`navi-artifact\n{"id":"x","title":"X","kind":"html"}\n---\n<div`);
check("a barely-started body is still dropped", barelyStarted.flush().includes("removed an incomplete"), true);

/* And the legacy shape keeps the behaviour it had: half a JSON envelope cannot
   be salvaged without inventing the rest of it. */
const cutEnvelope = createArtifactGate();
cutEnvelope.push(`\`\`\`navi-artifact\n{"id":"legacy","title":"Legacy","kind":"html","html":"<div class=\\"card\\">Half of`);
check("a cut JSON envelope is still dropped", cutEnvelope.flush().includes("removed an incomplete"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
