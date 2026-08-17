/* PATH: tests/navi-soul-orchestrator.test.ts  — NEW FILE, copy verbatim.
   Runs under the existing harness: `npm test` (tests/run.mjs). */

const { classifyIntent, wantsFreshInformation } = require("../lib/ai/navi-soul/intent") as typeof import("../lib/ai/navi-soul/intent");
const { planTurn, describePlan } = require("../lib/ai/navi-soul/orchestrator") as typeof import("../lib/ai/navi-soul/orchestrator");
const { preflightPayload, truncateMessagesToBudget } = require("../lib/ai/navi-soul/payload-preflight") as typeof import("../lib/ai/navi-soul/payload-preflight");
const { providerCeiling } = require("../lib/ai/navi-soul/provider-ceilings") as typeof import("../lib/ai/navi-soul/provider-ceilings");
const { validateGeneratedImage } = require("../lib/ai/navi-soul/image-preflight") as typeof import("../lib/ai/navi-soul/image-preflight");
const { lintArtifactContent, truncationSuspect } = require("../lib/ai/navi-soul/artifact-quality") as typeof import("../lib/ai/navi-soul/artifact-quality");
const { buildCapabilitySnapshot, capabilityBrief, wantsCapabilityBrief } = require("../lib/ai/navi-soul/capability-map") as typeof import("../lib/ai/navi-soul/capability-map");
const { decideLocallyWithSkills } = require("../lib/ai/navi-soul/router") as typeof import("../lib/ai/navi-soul/router");
const { ROUTES } = require("../lib/ai/providers") as typeof import("../lib/ai/providers");
const { markProviderFailure, resetProviderHealth } = require("../lib/ai/provider-health") as typeof import("../lib/ai/provider-health");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/** Every provider named, so availability literals cannot drift from the type. */
const avail = (on: Partial<Record<string, boolean>>) => ({
  gemini: false, groq: false, huggingface: false, cerebras: false, openrouter: false,
  deepseek: false, mistral: false, together: false, nvidia: false, sambanova: false,
  ...on
}) as import("../lib/ai/providers").ProviderAvailability;

const user = (content: string) => ({ role: "user", content }) as import("ai").ModelMessage;
const chatSignals = { hasImageAttachments: false, mode: "chat" as const };

async function main() {
  /* ---- Intent: the noun after the verb decides the pipeline ----------- */
  check("a picture ask is an image turn", classifyIntent("generate an image of a sunset over the ocean", chatSignals).intent, "image-create");
  check("an image GALLERY COMPONENT is an artifact, not a picture", classifyIntent("create an image gallery component with a lightbox", chatSignals).intent, "artifact");
  check("a bug report with a screenshot is not an image edit", classifyIntent("fix this bug on the settings screen", { hasImageAttachments: true, mode: "chat" }).intent !== "image-edit", true);
  check("attachment plus image-domain language is an edit", classifyIntent("remove the background from this photo", { hasImageAttachments: true, mode: "chat" }).intent, "image-edit");
  check("prose stays a conversation", classifyIntent("why is the sky blue", chatSignals).intent, "conversation");
  check("freshness is detected", wantsFreshInformation("what is the latest on the launch"), true);
  check("capability asks are detected", wantsCapabilityBrief("what can you do"), true);

  /* ---- The plan: pipeline, lane, health, fallbacks --------------------- */
  resetProviderHealth();
  const context = {
    request: "prove this inequality holds for all n", mode: "chat" as const, effort: "high" as const,
    complex: true, hasFiles: false, hasImageAttachments: false, longContext: false,
    tools: { web: false, code: false, artifacts: true }, availability: avail({ groq: true, gemini: true }),
    preset: "navi-soul" as const, meteredAllowed: false
  };
  const plan = planTurn(context);
  check("high effort lands in lane 3", plan.kind === "model" && plan.lane, 3);
  check("lane 3 without metered routes takes the strongest free brain", plan.kind === "model" && plan.route.provider, "groq");
  check("the engine is named by capability, never provider", plan.kind === "model" && plan.engine, "Navi Deep");
  check("fallbacks change provider", plan.kind === "model" && plan.fallbacks[0]?.provider, "gemini");
  check("a plan describes itself in one line", typeof describePlan(plan), "string");

  markProviderFailure("groq"); markProviderFailure("groq");
  const cooled = planTurn(context);
  check("a cooling primary is demoted, never dropped", cooled.kind === "model" && cooled.route.provider, "gemini");
  check("the cooled route survives as a fallback", cooled.kind === "model" && cooled.fallbacks.some((route) => route.provider === "groq"), true);
  resetProviderHealth();

  check("a certain picture ask short-circuits to the image pipeline", planTurn({ ...context, request: "draw me a poster of a mountain at dawn" }).kind, "image");
  check("an artifact ask earns the artifact prompt block", (() => { const p = planTurn({ ...context, request: "build a pomodoro timer app with a progress ring" }); return p.kind === "model" && p.promptBlocks.includes("artifact-discipline"); })(), true);
  check("no providers means a named refusal, not a throw", planTurn({ ...context, availability: avail({}) }).kind, "unconfigured");

  /* ---- Preflight: nothing is sent on hope ------------------------------ */
  check("the proven Groq ceiling holds by default", providerCeiling("groq"), 8000);
  const fits = preflightPayload({
    route: ROUTES.groqFast, availability: avail({ groq: true }),
    blocks: [{ name: "core", text: "You are Navi Soul." }, { name: "app-knowledge", text: "x".repeat(40000), optional: true }],
    tools: {}, messages: [user("hi")], outputReserve: 1000
  });
  check("optional blocks drop before anything else", fits.ok && fits.droppedBlocks, ["app-knowledge"]);

  /* ---- Memory is droppable, and drops before the conversation ----------- */

  /* It used to sit inside the required `turn` block, so the preflight could
     not touch it — and its trim order is optional blocks, then tools, then
     conversation history. A turn too large for its route therefore deleted
     what the user had just said in order to keep repeating what it had learned
     about them months ago. The remembered facts are worth less than the
     sentence they are being remembered during. */
  const squeezed = preflightPayload({
    route: ROUTES.groqFast,
    availability: avail({ groq: true }),
    blocks: [
      { name: "stable-prefix", text: "You are Navi Soul." },
      /* Comfortably past Groq's 8,000-token ceiling, so the preflight has to
         act rather than finding it already fits. */
      { name: "memory", text: `- a remembered fact.\n`.repeat(3_000), optional: true },
      { name: "turn", text: "Answer the question." }
    ],
    tools: {},
    messages: [user("something said three turns ago"), user("what did I just ask you")],
    outputReserve: 1_000
  });
  check("an oversized turn drops memory", squeezed.ok && squeezed.droppedBlocks.includes("memory"), true);
  check("and keeps the conversation that prompted it", squeezed.ok && squeezed.removedMessages, 0);

  /* The required blocks are never candidates, however large the request. */
  check("the prefix survives", squeezed.ok && !squeezed.droppedBlocks.includes("stable-prefix"), true);
  check("and so does the turn itself", squeezed.ok && !squeezed.droppedBlocks.includes("turn"), true);
  check("after dropping, the request fits without rerouting", fits.ok && !fits.rerouted, true);

  const rerouted = preflightPayload({
    route: ROUTES.groqFast, availability: avail({ groq: true, gemini: true }),
    blocks: [{ name: "core", text: "y".repeat(60000) }], tools: {}, messages: [user("hi")], outputReserve: 1000
  });
  check("a required payload too big for the lane reroutes to headroom", rerouted.ok && rerouted.rerouted && rerouted.route.provider, "gemini");

  const refused = preflightPayload({
    route: ROUTES.groqFast, availability: avail({ groq: true }),
    blocks: [{ name: "core", text: "z".repeat(60000) }], tools: {}, messages: [user("hi")], outputReserve: 1000
  });
  check("when nothing fits, the refusal names the ceiling", !refused.ok && /ceiling/.test((refused as { reason: string }).reason), true);

  const truncated = truncateMessagesToBudget([user("a".repeat(4000)), user("b".repeat(4000)), user("hello")], 500);
  check("history drops oldest-first", truncated.removed, 2);
  check("the request itself always survives", (truncated.messages[0] as { content: string }).content, "hello");
  const clipped = truncateMessagesToBudget([user("c".repeat(9000))], 500);
  check("an oversized request is clipped visibly, not failed", clipped.clipped && /trimmed the middle/.test((clipped.messages[0] as { content: string }).content), true);

  /* ---- Image preflight: an image is proven, not assumed ---------------- */
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048)]).toString("base64");
  const pngResult = validateGeneratedImage({ data: png, mimeType: "image/png" });
  check("a real PNG passes", pngResult.ok && pngResult.mimeType, "image/png");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)]).toString("base64");
  const relabelled = validateGeneratedImage({ data: jpeg, mimeType: "image/png" });
  check("a mislabelled real image is corrected, not rejected", relabelled.ok && relabelled.corrected && relabelled.mimeType, "image/jpeg");
  check("an error body is caught before anyone sees a broken card", validateGeneratedImage({ data: "not-base64!".repeat(400), mimeType: "image/png" }).ok, false);
  check("something too small to be a picture is caught", validateGeneratedImage({ data: png.slice(0, 200), mimeType: "image/png" }).ok, false);

  /* ---- Artifact quality: valid is not the same as good ----------------- */
  check("a payload cut mid-tag is named truncated", truncationSuspect("<div><p>hello</p><div class=") !== null, true);
  check("a dangling expression is named truncated", truncationSuspect("const total = price *") !== null, true);
  check("finished content raises no suspicion", truncationSuspect("<div><p>done</p></div>"), null);
  check("a bare package import earns a note", lintArtifactContent("import confetti from \"canvas-confetti\";\nexport default function App() { return null; }").length > 0, true);
  check("clean content earns no notes", lintArtifactContent("<main><h1>Hi</h1><p>All good here.</p></main>"), []);

  /* ---- Capability map: claims are checked, brands never leak ----------- */
  const snapshot = buildCapabilitySnapshot({
    availability: avail({ groq: true, gemini: true, cerebras: true, openrouter: true, mistral: true }),
    toolGroups: ["skills", "web", "environment"], skillCount: 82,
    mcpServers: [{ id: "notes", name: "Notes server" }],
    imageEngines: [{ name: "Navi Image", detail: "Everyday images, and every kind of edit" }],
    frontier: false
  });
  const brief = capabilityBrief(snapshot);
  check("the brief names engines by capability", /Navi Swift/.test(brief) && /Navi Deep/.test(brief), true);
  check("no provider brand ever leaks into the brief", /groq|gemini|hugging|openrouter|cerebras|mistral|deepseek|nvidia|sambanova|together|llama|qwen|flux/i.test(brief), false);
  check("the zero-token skills are stated", /82 deterministic tools/.test(brief) && /no tokens/.test(brief), true);

  /* ---- The wider doorway ------------------------------------------------ */
  const viaGate = await decideLocallyWithSkills("12*12", {}, async () => { throw new Error("must not be called"); });
  check("the gate answers before skills are consulted", viaGate.route, "local");
  const viaSkill = await decideLocallyWithSkills("sha256 of hello", {}, async () => ({ text: "2cf24d…", skill: "crypto.sha-hash" }));
  check("a skill hit answers locally with attribution", viaSkill.route === "local" && (viaSkill as { skill?: string }).skill, "crypto.sha-hash");
  const skillThrew = await decideLocallyWithSkills("sha256 of hello", {}, async () => { throw new Error("boom"); });
  check("a throwing skill costs nothing — the model still answers", skillThrew.route, "model");

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

export {};
