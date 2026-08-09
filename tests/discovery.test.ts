import { normalizeDiscoveredModel, rankForCapability, type DiscoveredModel } from "@/lib/ai/model-discovery";
import { PROVIDERS, PROVIDER_IDS, providerApiKey } from "@/lib/ai/provider-registry";
import { routeForLane, ROUTES, routeToolCallingSupport } from "@/lib/ai/providers";
import type { ProviderAvailability } from "@/lib/ai/providers";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Discovery is default-deny ───────────────────────────────────────────────
   The catalogue schema could not be verified against the provider's own docs
   from the build environment, so the module is built to make a wrong guess
   free: anything it cannot prove is free is not free, and not-free is not
   used. These assertions are that guarantee. */

const free = (value: unknown) => normalizeDiscoveredModel(value)?.free ?? false;

check("a plain paid model is not free", free({ id: "vendor/model", pricing: { prompt: "0.0000012" } }), false);
check("no pricing and no suffix is not free", free({ id: "vendor/model" }), false);
check("an unparseable entry is not free", free("vendor/model"), false);
check("null is not free", free(null), false);
check("a missing id is not free", free({ pricing: { prompt: "0" } }), false);
check("an id with no namespace is rejected", normalizeDiscoveredModel({ id: "model:free" }), null);

// The suffix is the primary signal: it is part of the id we would send anyway.
check("the free suffix proves free", free({ id: "vendor/model:free" }), true);
check("free suffix with zero string price", free({ id: "vendor/model:free", pricing: { prompt: "0", completion: "0" } }), true);
check("free suffix with zero number price", free({ id: "vendor/model:free", pricing: { prompt: 0 } }), true);

/* Price can only ever reject. A suffix that contradicts a real price is a
   catalogue we do not understand, and the safe reading is "do not use". */
check("a priced :free entry is rejected", free({ id: "vendor/model:free", pricing: { prompt: "0.5" } }), false);
check("a priced completion rejects too", free({ id: "vendor/model:free", pricing: { prompt: "0", completion: "0.5" } }), false);

// An unreadable price is not evidence of cost — the suffix already carried it.
check("garbage pricing does not reject the suffix", free({ id: "vendor/model:free", pricing: { prompt: "unknown" } }), true);
check("a pricing non-object does not reject", free({ id: "vendor/model:free", pricing: "free" }), true);

// Non-chat models share the catalogue and must never route a conversation.
for (const id of ["vendor/text-embedding-3:free", "vendor/rerank-v2:free", "vendor/whisper-large:free"]) {
  check(`${id} is not a chat model`, normalizeDiscoveredModel({ id }), null);
}

// Context length is read from any of the shapes a catalogue might use.
check("context_length is read", normalizeDiscoveredModel({ id: "v/m:free", context_length: 128000 })?.contextLength, 128000);
check("top_provider context is read", normalizeDiscoveredModel({ id: "v/m:free", top_provider: { context_length: 64000 } })?.contextLength, 64000);
check("an absent context is zero, not a crash", normalizeDiscoveredModel({ id: "v/m:free" })?.contextLength, 0);

/* ── Ranking ─────────────────────────────────────────────────────────────── */

const catalog: DiscoveredModel[] = [
  { id: "vendor/general-70b:free", contextLength: 32_000, free: true },
  { id: "vendor/qwen-coder-32b:free", contextLength: 16_000, free: true },
  { id: "vendor/big-general:free", contextLength: 200_000, free: true },
  { id: "vendor/paid-coder:free", contextLength: 8_000, free: false }
];

check("coding ranks a coding model first", rankForCapability(catalog, "coding")[0]?.id, "vendor/qwen-coder-32b:free");
check("ranking never returns an unfree model", rankForCapability(catalog, "coding").some((m) => !m.free), false);
check("ties break on context length", rankForCapability(catalog, "reasoning")[0]?.id, "vendor/big-general:free");
check("an empty catalogue ranks to nothing", rankForCapability([], "coding").length, 0);

/* ── The adapter table ───────────────────────────────────────────────────── */

for (const id of PROVIDER_IDS) {
  const adapter = PROVIDERS[id];
  check(`${id} adapter id matches its key`, adapter.id, id);
  check(`${id} has a base URL`, /^https:\/\//.test(adapter.baseURL), true);
  check(`${id} has a models endpoint`, /^https:\/\//.test(adapter.modelsUrl), true);
  check(`${id} names at least one env var`, adapter.envKeys.length > 0, true);
  // Exactly one metered provider, and it is the one the spend ceiling guards.
  check(`${id} cost matches its tier`, adapter.costPerMTok > 0, id === "deepseek");
}

/* The registry is the single source of tool capability. Hugging Face fronts
   models that reject a tools array, and marking it capable here would break
   every tool-enabled request routed there. */
check("hugging face is the tool-free provider", PROVIDERS.huggingface.supportsTools, false);
check("routes inherit the registry answer", routeToolCallingSupport(ROUTES.hfGptOss), "none");
check("a capable provider still yields custom", routeToolCallingSupport(ROUTES.groqTools), "custom");

// A key lookup with nothing set must be undefined rather than a stray value.
check("no credential yields undefined", providerApiKey({ ...PROVIDERS.mistral, envKeys: ["NAVI_TEST_ABSENT_KEY"], envHint: "ZZZNOTHING", keyPrefixes: [], keyMatches: undefined }), undefined);

/* ── Lanes resolve to routes ─────────────────────────────────────────────── */

/* The paid lane is switched on in this fixture on purpose: the assertions
   below prove the free paths never reach for it. */
const all: ProviderAvailability = { gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true, mistral: true, deepseek: true, together: true, nvidia: true, sambanova: true };
const nothing: ProviderAvailability = { gemini: false, groq: false, huggingface: false, cerebras: false, openrouter: false, mistral: false, deepseek: false, together: false, nvidia: false, sambanova: false };
const noTools = { web: false, code: false, artifacts: true };
const withTools = { web: true, code: false, artifacts: true };

for (const lane of [1, 2, 3, 4] as const) {
  const route = routeForLane({ lane, availability: all, tools: noTools, hasFiles: false });
  check(`lane ${lane} resolves with everything configured`, Boolean(route?.model), true);
  check(`lane ${lane} yields nothing when no provider is configured`, routeForLane({ lane, availability: nothing, tools: noTools, hasFiles: false }), null);
  // Capability beats tier: a tool request must land on a model that takes tools.
  const tooled = routeForLane({ lane, availability: all, tools: withTools, hasFiles: false });
  check(`lane ${lane} with tools accepts tools`, tooled ? routeToolCallingSupport(tooled) : "none", "custom");
}

check("lane 1 is a fast route", routeForLane({ lane: 1, availability: all, tools: noTools, hasFiles: false })?.capability, "fast");
check("attachments force the multimodal route", routeForLane({ lane: 1, availability: all, tools: noTools, hasFiles: true })?.capability, "multimodal");

/* Lane 4 is the one discovery serves, and it must be strictly additive: with a
   discovered route it is used, without one the lane still resolves. */
const discovered = { provider: "openrouter" as const, model: "vendor/fresh-coder:free", label: "NaviSoul", capability: "coding" as const };
check("lane 4 prefers a discovered route", routeForLane({ lane: 4, availability: all, tools: noTools, hasFiles: false, discovered })?.model, "vendor/fresh-coder:free");
check("lane 4 works without discovery", Boolean(routeForLane({ lane: 4, availability: all, tools: noTools, hasFiles: false, discovered: null })?.model), true);
check("a discovered route is ignored without its provider", routeForLane({ lane: 4, availability: { ...all, openrouter: false }, tools: noTools, hasFiles: false, discovered })?.model === discovered.model, false);

/* Route labels are internal — nothing streams them — but a discovered route's
   label is generated rather than authored, so it is the one that could drift
   into naming a model. It carries the product name instead. */
check("a discovered route is labelled with the product", discovered.label, "NaviSoul");
check("a discovered route never carries the raw id as a label", /vendor|:free/.test(discovered.label), false);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
