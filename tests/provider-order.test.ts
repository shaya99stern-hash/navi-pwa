/**
 * Hugging Face is last, and nothing may quietly move it back.
 *
 * The deployment's Hugging Face account is a free one whose monthly Inference
 * Providers credit is spent. With HF ahead of Groq in four ladders, a turn
 * picked the one provider guaranteed to answer 402: two stored assistant
 * messages carry a `data-engine` part per attempt and no text part at all —
 * two engines tried, nothing produced.
 *
 * `provider-health` already demotes an exhausted provider for thirty minutes,
 * and that stays. But it is per-edge-instance memory that resets constantly,
 * so it re-learns the same fact all day. The ordering is the durable fix, and
 * an ordering with nothing asserting it is a comment.
 *
 * These are property assertions, not a snapshot of the current arrangement:
 * they say "Groq outranks Hugging Face wherever both can serve", which stays
 * true as routes are added, rather than pinning today's exact return values.
 */
import { ROUTES, routeForLane, selectDirectRoute, availableSwarmRoutes } from "@/lib/ai/providers";
import type { Lane, ProviderAvailability } from "@/lib/ai/providers";
import { PROVIDER_IDS } from "@/lib/ai/provider-registry";
import type { ModelPreset, ProviderName, ToolPolicy } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const avail = (...on: ProviderName[]): ProviderAvailability => {
  const out = {} as ProviderAvailability;
  for (const id of PROVIDER_IDS) out[id] = on.includes(id);
  return out;
};

const NO_TOOLS: ToolPolicy = { web: false, code: false, artifacts: false };
const WEB: ToolPolicy = { web: true, code: false, artifacts: false };
const CODE: ToolPolicy = { web: false, code: true, artifacts: false };
const TOOL_POLICIES = [NO_TOOLS, WEB, CODE];
const LANES: Lane[] = [1, 2, 3, 4];
/* The presets that fall through to the general ladder. The three `*-direct`
   presets are an explicit user choice and are checked separately. */
const LADDER_PRESETS: ModelPreset[] = ["navi-soul", "navi-code", "auto"];

/* ---- Groq outranks Hugging Face in every text ladder ------------------- */

/* Both configured, plus — one at a time — every other provider the app knows,
   so a third provider cannot reintroduce the fall-through. */
for (const extra of [null, ...PROVIDER_IDS] as Array<ProviderName | null>) {
  const availability = extra ? avail("groq", "huggingface", extra) : avail("groq", "huggingface");
  const label = extra ? `groq+hf+${extra}` : "groq+hf";
  const picks: string[] = [];

  for (const lane of LANES) {
    for (const tools of TOOL_POLICIES) {
      for (const meteredAllowed of [true, false]) {
        for (const taskKind of [null, "mechanical"] as const) {
          const route = routeForLane({ lane, availability, tools, hasFiles: false, meteredAllowed, taskKind });
          if (route) picks.push(route.provider);
        }
      }
    }
  }

  for (const preset of LADDER_PRESETS) {
    for (const tools of TOOL_POLICIES) {
      for (const complex of [true, false]) {
        picks.push(selectDirectRoute({ preset, availability, hasFiles: false, tools, complex }).provider);
      }
    }
  }

  check(`${label}: never falls to hugging face`, picks.includes("huggingface"), false);
  check(`${label}: something answered`, picks.length > 0, true);
}

/* ---- Demoted, not removed --------------------------------------------- */

const onlyHf = avail("huggingface");
check("hf alone still serves lane 3", routeForLane({ lane: 3, availability: onlyHf, tools: NO_TOOLS, hasFiles: false })?.provider, "huggingface");
check("hf alone still serves lane 4", routeForLane({ lane: 4, availability: onlyHf, tools: NO_TOOLS, hasFiles: false })?.provider, "huggingface");
for (const preset of LADDER_PRESETS) {
  for (const complex of [true, false]) {
    const route = selectDirectRoute({ preset, availability: onlyHf, hasFiles: false, tools: NO_TOOLS, complex });
    check(`hf alone serves ${preset} (complex=${complex})`, route.provider, "huggingface");
  }
}

/* ---- Cerebras above Hugging Face in lane 4 ---------------------------- */

check(
  "lane 4 prefers cerebras to hugging face",
  routeForLane({ lane: 4, availability: avail("cerebras", "huggingface"), tools: NO_TOOLS, hasFiles: false })?.model,
  ROUTES.cerebrasLarge.model
);

/* ---- The two exemptions stay exempt ----------------------------------- */

/* Groq has no vision route, so attachments still reach for Gemini, then HF.
   Demoting HF here would mean answering "I cannot see images" while holding a
   provider that can. */
check(
  "attachments prefer gemini",
  routeForLane({ lane: 2, availability: avail("gemini", "groq", "huggingface"), tools: NO_TOOLS, hasFiles: true })?.provider,
  "gemini"
);
check(
  "attachments still reach hugging face when gemini is absent",
  routeForLane({ lane: 2, availability: avail("groq", "huggingface"), tools: NO_TOOLS, hasFiles: true })?.provider,
  "huggingface"
);
check(
  "direct-route attachments still reach hugging face",
  selectDirectRoute({ preset: "auto", availability: avail("groq", "huggingface"), hasFiles: true, tools: NO_TOOLS, complex: false }).provider,
  "huggingface"
);

/* An explicitly chosen provider is not a fallback and is never second-guessed. */
check(
  "huggingface-direct is honoured with groq available",
  selectDirectRoute({ preset: "huggingface-direct", availability: avail("groq", "huggingface"), hasFiles: false, tools: NO_TOOLS, complex: false }).provider,
  "huggingface"
);

/* ---- The advice given when nothing is configured ---------------------- */

const messageFor = (preset: ModelPreset): string => {
  try {
    selectDirectRoute({ preset, availability: avail(), hasFiles: false, tools: NO_TOOLS, complex: false });
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
for (const preset of ["navi-code", "auto"] as ModelPreset[]) {
  const message = messageFor(preset);
  check(`${preset}: names a provider to configure`, message.includes("GROQ_API_KEY"), true);
  /* Leading with HF_TOKEN sent people to configure the one provider that will
     not serve them. */
  check(`${preset}: does not send anyone to hugging face`, message.includes("HF_TOKEN"), false);
  check(`${preset}: groq before gemini`, message.indexOf("GROQ_API_KEY") < message.indexOf("GEMINI_API_KEY"), true);
}

/* ---- The gated model is gone ------------------------------------------ */

/* `meta-llama/Llama-3.3-70B-Instruct` needs a license acceptance on the
   token's own account; without it the route answers a permission error
   whatever the credit balance says, which as a council member is a guaranteed
   empty seat. */
const allRoutes = Object.values(ROUTES) as Array<{ model: string }>;
check("no gated llama route is defined", allRoutes.some((r) => r.model.includes("Llama-3.3-70B-Instruct") && !r.model.startsWith("Meta-")), false);
const council = availableSwarmRoutes(avail(...PROVIDER_IDS), NO_TOOLS);
check("council pool excludes the gated llama", council.some((r) => r.provider === "huggingface" && r.model.includes("Llama-3.3-70B")), false);
check("council pool is not empty", council.length > 0, true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
