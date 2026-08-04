import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createArtifactGate } from "@/lib/ai/artifact-gate";
import { correctionBlock, correctionFrom, withTimeout } from "@/lib/ai/swarm";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── The council must not gate the stream ────────────────────────────────────
   The defect this replaces: three blocking stages ran to completion before a
   single character reached the user, routinely fifteen to forty seconds of
   blank screen. The regression to guard against is someone putting an `await`
   back in front of the council, which would restore exactly that behaviour and
   would not fail any behavioural test — the answer would still be correct, it
   would just arrive far too late. So this reads the source. */

const swarmSource = readFileSync(join(process.cwd(), "lib/ai/swarm.ts"), "utf8");
const kickoff = swarmSource.indexOf("const councilPromise = gatherEvidence(");
const streamLoop = swarmSource.indexOf("for await (const delta of lead.textStream)");
const councilAwait = swarmSource.indexOf("await withTimeout(councilPromise");

check("the council is started", kickoff > -1, true);
check("the lead stream loop exists", streamLoop > -1, true);
check("the council is never awaited on kickoff", /await\s+gatherEvidence\(/.test(swarmSource), false);
check("the council starts before the stream", kickoff < streamLoop, true);
check("the council is awaited only after the stream has run", councilAwait > streamLoop, true);

// The old shape paced out a finished answer to look like typing. It is gone.
const routeSource = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
check("no fake typing cadence remains", /splitForCadence|SWARM_CADENCE_TOTAL_MS/.test(routeSource), false);
check("the text part opens before the swarm runs", routeSource.indexOf('writer.write({ type: "text-start", id: textId });') < routeSource.indexOf("await runComposite("), true);

/* ── A dropped council is a non-event ────────────────────────────────────── */

async function main() {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 400));
  check("work past the budget resolves to null", await withTimeout(slow, 20), null);

  const quick = Promise.resolve("evidence");
  check("work inside the budget comes back", await withTimeout(quick, 500), "evidence");

  /* A rejection must stay a rejection so the caller's own .catch handles it,
     rather than being silently read as "no evidence". */
  let rejected = false;
  await withTimeout(Promise.reject(new Error("council failed")), 500).catch(() => { rejected = true; });
  check("a failing council still rejects", rejected, true);
}

/* ── Verification appends, never rewrites ────────────────────────────────── */

const answer = "The config lives in next.config.ts and the middleware file is proxy.ts.".repeat(6);

check("the sentinel means silence", correctionFrom("CONSISTENT", answer), null);
check("the sentinel is matched case-insensitively", correctionFrom("consistent", answer), null);
check("the sentinel with trailing noise is still silence", correctionFrom("CONSISTENT.\n", answer), null);
check("an empty reply is silence", correctionFrom("   ", answer), null);

const real = "The middleware file is named proxy.ts, not middleware.ts.";
check("a real correction comes through", correctionFrom(real, answer), real);
check("a correction is trimmed", correctionFrom(`\n  ${real}  \n`, answer), real);

/* A verifier told not to rewrite sometimes rewrites anyway. A "correction" the
   length of the answer is a second answer, and showing the user both is worse
   than showing them one. */
check("a full rewrite is rejected", correctionFrom(answer + " and some more", answer), null);
check("a long correction on a short answer is kept", Boolean(correctionFrom("x".repeat(300), "short answer")), true);

check("the correction is delimited", correctionBlock("It is proxy.ts.").startsWith("\n\n---\n\n"), true);
check("the correction is labelled", correctionBlock("It is proxy.ts.").includes("**One correction.**"), true);
check("the correction never names the verifier", /verif|council|workstream|model/i.test(correctionBlock("It is proxy.ts.")), false);

/* ── Artifact payloads are never half-shown ──────────────────────────────── */

const artifact = JSON.stringify({ id: "a1", title: "Counter", kind: "html", html: "<button>1</button>", height: 200 });
const fenced = "```navi-artifact\n" + artifact + "\n```";

function streamThrough(deltas: string[]): string {
  const gate = createArtifactGate();
  let out = "";
  for (const delta of deltas) out += gate.push(delta);
  return out + gate.flush();
}

// Prose is not delayed by the gate's existence.
check("plain prose passes through whole", streamThrough(["Hello ", "there, ", "friend."]), "Hello there, friend.");
check("prose arrives across many deltas", streamThrough("The quick brown fox.".split("")), "The quick brown fox.");

// A complete payload survives intact, however it is chopped up.
check("a whole artifact survives", streamThrough([`Here:\n${fenced}\nDone.`]), `Here:\n${fenced}\nDone.`);
check("an artifact split mid-fence survives", streamThrough([`Here:\n\`\`\`navi-art`, `ifact\n${artifact}\n\`\`\`\nDone.`]), `Here:\n${fenced}\nDone.`);
check("an artifact split character by character survives", streamThrough(`Here:\n${fenced}\nDone.`.split("")), `Here:\n${fenced}\nDone.`);

// Nothing of a payload leaks before it can be validated.
const partial = createArtifactGate();
const beforeClose = partial.push("Intro text.\n```navi-artifact\n" + artifact.slice(0, 40));
check("prose before a fence is released", beforeClose, "Intro text.\n");
check("an unclosed payload is withheld", beforeClose.includes("html"), false);
check("an unclosed payload is dropped at the end", partial.flush(), "\n> NaviSol removed an incomplete artifact payload.\n");

// An invalid payload is replaced rather than rendered.
const broken = streamThrough(["```navi-artifact\n{not json}\n```"]);
check("malformed JSON is replaced", broken.includes("malformed artifact payload"), true);
check("malformed JSON never reaches the reader", broken.includes("not json"), false);

const wrongShape = streamThrough(["```navi-artifact\n" + JSON.stringify({ id: "x" }) + "\n```"]);
check("an invalid payload is replaced", /removed an (invalid|malformed) artifact payload/.test(wrongShape), true);

// Two payloads in one answer both get checked.
const two = streamThrough([`${fenced}\nand\n${fenced}`]);
check("a second artifact is handled too", two, `${fenced}\nand\n${fenced}`);

// A stray backtick run is not mistaken for a payload.
check("an ordinary code fence is untouched", streamThrough(["```ts\nconst a = 1;\n```"]), "```ts\nconst a = 1;\n```");

main().then(() => {
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
