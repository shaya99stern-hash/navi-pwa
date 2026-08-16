/* PATH: tests/readable.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The substrate layer, tested against the failures it exists to fix.
 *
 * Everything above this — synthesis, verification, memory — reasons over
 * whatever this function returns. Boilerplate that survives extraction is
 * boilerplate the model treats as evidence, and a link destroyed here is a hop
 * a crawl can never take. Errors at this layer do not stay at this layer.
 */

const { extractReadable } = require("../lib/ai/readable") as typeof import("../lib/ai/readable");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Links survive, and they survive fetchable ───────────────────────────── */

/* The single most consequential fix. The old chain deleted every tag, so every
   href went with it: a model could read that a page mentioned a filing and had
   no way to learn where it linked. Multi-hop crawling was blind by
   construction — hop one could never discover the address of hop two. */
const linked = extractReadable(
  `<p>See the <a href="/records/2026">county records</a> for detail.</p>`,
  { baseUrl: "https://county.example.gov/property/index.html" }
);
check("a link keeps its text", linked.includes("county records"), true);
check("and becomes an absolute, fetchable address",
  linked.includes("https://county.example.gov/records/2026"), true);

check("an absolute href is left alone",
  extractReadable(`<a href="https://a.example/x">x</a>`).includes("https://a.example/x"), true);
/* Without a base there is nothing to resolve against, and emitting a bare path
   would hand the model an address it cannot fetch. The text is kept. */
const noBase = extractReadable(`<p>see <a href="/only/a/path">the filing</a></p>`);
check("a relative href with no base keeps the text", noBase.includes("the filing"), true);
check("and does not emit an unfetchable path", noBase.includes("(/only/a/path)"), false);
check("javascript hrefs are not turned into links",
  extractReadable(`<a href="javascript:void(0)">click</a>`).includes("]("), false);

/* ── Furniture goes, content stays ───────────────────────────────────────── */

const page = extractReadable(`
  <html><body>
    <nav><a href="/home">Home</a><a href="/about">About</a></nav>
    <header>Site Name</header>
    <main><h1>Tax Delinquency Notice</h1><p>The parcel is three years in arrears.</p></main>
    <aside>Related stories</aside>
    <footer>© 2026 Example County</footer>
    <script>tracking()</script>
    <style>.x{color:red}</style>
  </body></html>
`, { baseUrl: "https://example.gov/" });

check("the actual content survives", page.includes("three years in arrears"), true);
check("the heading survives, marked as one", page.includes("# Tax Delinquency Notice"), true);
check("navigation is gone", page.includes("About"), false);
check("the header is gone", page.includes("Site Name"), false);
check("the sidebar is gone", page.includes("Related stories"), false);
check("the footer is gone", page.includes("Example County"), false);
check("script bodies never reach the model", page.includes("tracking()"), false);
check("neither does CSS", page.includes("color:red"), false);

/* A `<nav>` inside a `<nav>` is the case a non-greedy match gets wrong: it
   closes at the first `</nav>` and leaves the rest of the menu behind as
   prose. Depth counting is why this passes. */
const nested = extractReadable(`<nav><nav><a href="/a">Inner</a></nav><a href="/b">Outer</a></nav><p>Body text here.</p>`);
check("a nested nav is removed completely", nested.includes("Inner") || nested.includes("Outer"), false);
check("and the body after it is kept", nested.includes("Body text here."), true);

/* ── Structure that carries meaning ──────────────────────────────────────── */

const table = extractReadable(`
  <table>
    <tr><th>State</th><th>Rate</th></tr>
    <tr><td>Nevada</td><td>$68.40</td></tr>
    <tr><td>Oregon</td><td>$71.15</td></tr>
  </table>
`);
/* Flattened into prose a rate table is unreadable, and rate tables are exactly
   the artefact worth fetching — the row is the unit of meaning, not the word. */
check("table rows stay rows", table.includes("Nevada | $68.40"), true);
check("each row is its own line", table.includes("Oregon | $71.15"), true);
check("Nevada's rate is not run together with Oregon's",
  /Nevada \| \$68\.40\s*\n\s*Oregon/.test(table), true);

const list = extractReadable(`<ul><li>Assessor</li><li>Recorder</li><li>Treasurer</li></ul>`);
check("list items become list items", list.includes("- Assessor"), true);
check("and stay separate", list.includes("- Recorder") && list.includes("- Treasurer"), true);

/* ── Entities ────────────────────────────────────────────────────────────── */

check("numeric entities decode", extractReadable("<p>&#8212;dash</p>"), "—dash");
check("hex entities decode", extractReadable("<p>it&#x27;s</p>"), "it's");
check("named entities decode", extractReadable("<p>caf&eacute; &mdash; open</p>").includes("—"), true);
/* Decoding `&amp;` first would turn the escaped, literal text `&lt;` into a
   working `<` — wrong, and a way to reintroduce markup after tags are gone. */
check("an escaped entity stays escaped rather than becoming markup",
  extractReadable("<p>&amp;lt;script&amp;gt;</p>"), "&lt;script&gt;");
check("an out-of-range numeric entity does not throw",
  typeof extractReadable("<p>a&#1114112;b</p>"), "string");

/* ── Shapes that must not throw ──────────────────────────────────────────── */

check("empty input yields empty output", extractReadable(""), "");
check("plain text with no markup survives", extractReadable("just words"), "just words");
check("an unclosed tag does not lose the document",
  extractReadable("<p>before<div>after").includes("before"), true);
check("an unclosed furniture element does not eat the page",
  typeof extractReadable("<nav><p>orphan"), "string");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
