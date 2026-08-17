import { createArtifactGate } from "@/lib/ai/artifact-gate";
import { buildArtifactDocument, isArtifactFenceLanguage, looksLikeArtifactFence, markdownToArtifactHtml, recoverArtifactPayload, repairArtifactPayload, tolerantParseJson } from "@/lib/security/artifacts";

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

/* The bodies below carry real content because the gate now rejects a completed
   fence holding fewer than 40 characters of it as a stub. These checks are
   about salvage and normalisation, so their fixtures stay above that floor. */
const salvaged = streamThrough(['```navi-artifact\n{"title": "Doc", "kind": "markdown", "content": "# Title\n\nBody text long enough to be a real document.",}\n```']);
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


/* ── Aliased fences ──────────────────────────────────────────────────────────
   Models emit ```artifact and ```react-component constantly. Nothing rendered
   those, so a complete working payload arrived as a wall of raw JSON. */

check("the canonical fence is recognised", isArtifactFenceLanguage("navi-artifact"), true);
check("a bare artifact fence is recognised", isArtifactFenceLanguage("artifact"), true);
check("react-component is recognised", isArtifactFenceLanguage("react-component"), true);
check("case does not matter", isArtifactFenceLanguage("Artifact"), true);
check("a real language is not an artifact fence", isArtifactFenceLanguage("ts"), false);
check("html is not an artifact fence", isArtifactFenceLanguage("html"), false);

const realPayload = JSON.stringify({
  id: "counter",
  title: "Counter",
  kind: "html",
  html: "<p>hi</p><p>A body with enough content to clear the stub floor.</p>"
});
check("a payload body is detected", looksLikeArtifactFence(realPayload), true);
check("ordinary code is not a payload", looksLikeArtifactFence("const a = 1;"), false);
/* An object with no content field is config, not an artifact. */
check("a config object is not a payload", looksLikeArtifactFence('{"id":"x","title":"y"}'), false);
check("content without any identity is not a payload", looksLikeArtifactFence('{"html":"<p>x</p>"}'), false);

const aliasStream = streamThrough([`\`\`\`artifact\n${JSON.stringify({
  id: "omni",
  title: "Omni",
  kind: "react-component",
  html: "<p>x</p><p>A body with enough content to clear the stub floor.</p>"
})}\n\`\`\``]);
check("an aliased fence is normalised to the canonical one", aliasStream.includes("```navi-artifact"), true);
check("the alias label does not survive", /```artifact\b/.test(aliasStream), false);
check("the aliased payload becomes html", aliasStream.includes('"kind":"html"'), true);

/* The scanner must not mistake the alias for the canonical fence's suffix. */
const canonicalStream = streamThrough([`\`\`\`navi-artifact\n${realPayload}\n\`\`\``]);
check("the canonical fence still passes through", canonicalStream.includes("```navi-artifact"), true);
check("no stray notice on a valid payload", canonicalStream.includes("removed"), false);

/* ── Wrappings observed on a real device ─────────────────────────────────────
   Both of these arrived from the live app and both reached the reader as an
   error: one as "The artifact payload could not be read as JSON", the other as
   a wall of raw JSON under a NAVIOPI-ARTIFACT heading. In each case the
   artifact itself was intact and only its packaging was wrong. */

const doc = "<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>";

/* A label no enumerated list would have held. Matching the word rather than
   the exact string is what covers the whole family. */
check("a hallucinated label still reads as an artifact", isArtifactFenceLanguage("naviopi-artifact"), true);
check("and does so case-insensitively", isArtifactFenceLanguage("NAVIOPI-ARTIFACT"), true);
check("an ordinary language is untouched", isArtifactFenceLanguage("json"), false);
check("so is typescript", isArtifactFenceLanguage("typescript"), false);

/* The model wrapped the artifact one level too deep: an envelope whose single
   key held a complete fence. */
const doubleWrapped = recoverArtifactPayload(JSON.stringify({ artifact: `\`\`\`navi-artifact\n${doc}\n\`\`\`` }));
check("a double-wrapped artifact recovers", doubleWrapped.ok, true);
check("and keeps its document", doubleWrapped.ok && doubleWrapped.payload.html?.includes("<h1>Hi</h1>"), true);

/* A correct payload fenced as ```json rather than ```navi-artifact. */
const jsonFenced = recoverArtifactPayload("```json\n" + realPayload + "\n```");
check("a json-fenced payload recovers", jsonFenced.ok, true);

/* Envelope → fence → JSON. The inner object owns the metadata. */
const nested = recoverArtifactPayload(JSON.stringify({ artifact: "```navi-artifact\n" + realPayload + "\n```" }));
check("a fence nested in an envelope recovers", nested.ok, true);
check("and the inner title wins", nested.ok && nested.payload.title, "Counter");

const oddLabelStream = streamThrough([`\`\`\`naviopi-artifact\n${realPayload}\n\`\`\``]);
check("the gate normalises a hallucinated label", oddLabelStream.includes("```navi-artifact"), true);
check("and the odd label does not survive", /naviopi/.test(oddLabelStream), false);

/* ── Dark-mode repair for model-authored light designs ──────────────────── */

const darkDocument = buildArtifactDocument({ id: "a", title: "A", kind: "html", html: '<div style="background:#fff">x</div>' }, "dark");
check("dark artifacts carry the repair rule", darkDocument.includes("--navi-surface"), true);
check("theme variables are exposed to the artifact", darkDocument.includes("--navi-accent"), true);
const lightDocument = buildArtifactDocument({ id: "a", title: "A", kind: "html", html: "<p>x</p>" }, "light");
check("light artifacts are left alone", lightDocument.includes("!important"), false);
check("light artifacts still get the variables", lightDocument.includes("--navi-fg"), true);

/* ── The frame must not grow itself ─────────────────────────────────────────
   The bridge reported `documentElement.scrollHeight` and observed the same
   element. Inside an iframe that element *is* the viewport, so its height is
   whatever the parent last set — and body carries 16px of padding, so every
   observation reported 32px more than the last. The frame ratcheted upward
   until it hit its 900px clamp and sat there with a large dead region below
   content that had never grown at all. On a phone that is most of the screen.

   Nothing errored. It looked like an artifact that renders badly. */

const bridgeSource = (require("node:fs") as typeof import("node:fs"))
  .readFileSync((require("node:path") as typeof import("node:path")).join(process.cwd(), "lib/security/artifacts.ts"), "utf8");

check("the bridge no longer reports the document's own box",
  /height: Math\.ceil\(document\.documentElement\.scrollHeight\)/.test(bridgeSource), false);
check("it measures the content's furthest edge instead",
  /getBoundingClientRect\(\)\.bottom \+ window\.scrollY/.test(bridgeSource), true);
/* Content sized in viewport units fills whatever it is given and can never
   report a natural height, so it is reported unchanged rather than with
   padding added. That is what stops the loop at its source. */
check("viewport-filling content is reported without padding added",
  /content <= viewport \+ 4 \? viewport : content \+ 16/.test(bridgeSource), true);
check("and the observer watches the body, not the viewport",
  /new ResizeObserver\(resize\)\.observe\(document\.body\)/.test(bridgeSource), true);

const frameSource = (require("node:fs") as typeof import("node:fs"))
  .readFileSync((require("node:path") as typeof import("node:path")).join(process.cwd(), "app/components/artifact-frame.tsx"), "utf8");

/* The half that reaches a client running a service-worker-cached build, which
   still sends the old report and would still ratchet without this. */
check("the frame ignores a report that merely echoes its own height",
  /next - current <= 40/.test(frameSource), true);
check("while a genuine jump is still honoured", /echo \? current : next/.test(frameSource), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
