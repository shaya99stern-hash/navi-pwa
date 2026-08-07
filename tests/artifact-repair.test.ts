import { createArtifactGate } from "@/lib/ai/artifact-gate";
import { markdownToArtifactHtml, recoverArtifactPayload, repairArtifactPayload, tolerantParseJson } from "@/lib/security/artifacts";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Tolerant JSON ───────────────────────────────────────────────────────────
   Every case here is a shape a real model actually emitted in this app's chat
   history before being replaced with "Malformed artifact payload." */

check("clean JSON parses", tolerantParseJson('{"a":1}'), { a: 1 });
check("surrounding prose is stripped", tolerantParseJson('Here is the artifact:\n{"a":1}\nEnjoy!'), { a: 1 });
check("a trailing comma is repaired", tolerantParseJson('{"a":1,}'), { a: 1 });
check("smart quotes are repaired", tolerantParseJson('{“a”:“b”}'), { a: "b" });
check("raw newlines inside strings are escaped", tolerantParseJson('{"a":"line one\nline two"}'), { a: "line one\nline two" });
check("hopeless input yields undefined", tolerantParseJson("{not json}"), undefined);
check("no braces yields undefined", tolerantParseJson("just words"), undefined);

/* ── Payload repair ─────────────────────────────────────────────────────── */

const repairedAlias = repairArtifactPayload({ kind: "markdown", title: "Notes", content: "# Hello\n\nSome **bold** text." });
check("a markdown kind is coerced to html", repairedAlias?.kind, "html");
check("markdown content is rendered", repairedAlias?.html?.includes("<h1>Hello</h1>"), true);
check("markdown emphasis is rendered", repairedAlias?.html?.includes("<strong>bold</strong>"), true);
check("the given title survives repair", repairedAlias?.title, "Notes");

const missingBits = repairArtifactPayload({ html: "<p>Just content, nothing else.</p>" });
check("a payload with only content gets an id", typeof missingBits?.id === "string" && missingBits.id.length > 0, true);
check("a payload with only content gets a title", typeof missingBits?.title === "string" && missingBits.title.length > 0, true);

const svgSniffed = repairArtifactPayload({ id: "pic", title: "Pic", kind: "diagram", content: "<svg viewBox='0 0 10 10'><rect/></svg>" });
check("svg content is detected despite a bogus kind", svgSniffed?.kind, "svg");

const rawMarkup = repairArtifactPayload("<svg viewBox='0 0 10 10'><circle r='4'/></svg>");
check("a bare svg string becomes an svg artifact", rawMarkup?.kind, "svg");

check("empty input cannot be repaired", repairArtifactPayload({ id: "x" }), null);
check("whitespace content cannot be repaired", repairArtifactPayload({ html: "   " }), null);

const pdfAsk = repairArtifactPayload({ id: "report", title: "Q3 Report", kind: "pdf", body: "## Revenue\n\n- Up 12%\n- Costs flat" });
check("a pdf kind renders as an html document", pdfAsk?.kind, "html");
check("pdf-kind markdown becomes structured html", pdfAsk?.html?.includes("<h2>Revenue</h2>"), true);
check("pdf-kind lists are rendered", pdfAsk?.html?.includes("<li>Up 12%</li>"), true);

/* ── Markdown converter safety ──────────────────────────────────────────── */

check("markdown html is escaped", markdownToArtifactHtml("<script>alert(1)</script>").includes("<script>"), false);
check("code fences are preserved verbatim", markdownToArtifactHtml("```js\nconst a = 1 < 2;\n```").includes("const a = 1 &lt; 2;"), true);
check("ordered lists are ordered", markdownToArtifactHtml("1. one\n2. two").startsWith("<ol>"), true);

/* ── The shared recovery entry point ────────────────────────────────────── */

const strict = recoverArtifactPayload(JSON.stringify({ id: "ok", title: "Ok", kind: "html", html: "<p>hi</p>", height: 300 }));
check("a strict payload recovers as itself", strict.ok && strict.payload.id, "ok");

const sloppy = recoverArtifactPayload('Sure! Here it is:\n{"title": "Chart", "kind": "svg", "content": "<svg viewBox=\'0 0 4 4\'></svg>",}');
check("a sloppy fence recovers", sloppy.ok, true);
check("the sloppy fence kind is svg", sloppy.ok && sloppy.payload.kind, "svg");

const hopeless = recoverArtifactPayload("nothing renderable here");
check("hopeless input reports a reason", hopeless.ok, false);

/* ── The gate re-emits salvaged payloads instead of dropping them ────────── */

function streamThrough(deltas: string[]): string {
  const gate = createArtifactGate();
  let out = "";
  for (const delta of deltas) out += gate.push(delta);
  return out + gate.flush();
}

const salvaged = streamThrough(['```navi-artifact\n{"title": "Doc", "kind": "markdown", "content": "# Title\n\nBody",}\n```']);
check("the gate salvages a sloppy artifact", salvaged.includes("```navi-artifact"), true);
check("the salvaged artifact is canonical JSON", (() => {
  const inner = /```navi-artifact\n([\s\S]*?)\n```/.exec(salvaged)?.[1] ?? "";
  try { return (JSON.parse(inner) as { kind?: string }).kind === "html"; } catch { return false; }
})(), true);
check("no notice appears for a salvageable artifact", salvaged.includes("removed"), false);

const stillBroken = streamThrough(["```navi-artifact\n{not json}\n```"]);
check("truly hopeless payloads still get the notice", stillBroken.includes("malformed artifact payload"), true);

const rawSvgFence = streamThrough(["```navi-artifact\n<svg viewBox='0 0 8 8'><rect/></svg>\n```"]);
check("raw svg in the fence is salvaged", rawSvgFence.includes('"kind":"svg"'), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
