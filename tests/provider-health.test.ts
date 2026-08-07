import {
  coolingProviders,
  isProviderCooling,
  markProviderFailure,
  markProviderSuccess,
  orderRoutesByHealth,
  resetProviderHealth
} from "@/lib/ai/provider-health";
import type { ProviderRoute } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const route = (provider: ProviderRoute["provider"]): ProviderRoute => ({ provider, model: "m", label: provider, capability: "balanced" });

/* ── One failure is weather; repeated failure is a pattern ──────────────── */

resetProviderHealth();
markProviderFailure("groq");
check("one failure does not cool a provider", isProviderCooling("groq"), false);
markProviderFailure("groq");
check("two failures start the cooldown", isProviderCooling("groq"), true);
check("the cooling list names it", coolingProviders(), ["groq"]);

/* ── Success clears the record entirely ─────────────────────────────────── */

markProviderSuccess("groq");
check("one success clears the cooldown", isProviderCooling("groq"), false);
markProviderFailure("groq");
check("the failure count also reset", isProviderCooling("groq"), false);

/* ── Ordering deprioritizes but never drops ─────────────────────────────── */

resetProviderHealth();
markProviderFailure("gemini");
markProviderFailure("gemini");
const ordered = orderRoutesByHealth([route("gemini"), route("groq"), route("huggingface")]);
check("a cooling provider moves to the back", ordered.map((entry) => entry.provider), ["groq", "huggingface", "gemini"]);
check("nothing is dropped", ordered.length, 3);

markProviderFailure("groq"); markProviderFailure("groq");
markProviderFailure("huggingface"); markProviderFailure("huggingface");
const allCooling = orderRoutesByHealth([route("gemini"), route("groq"), route("huggingface")]);
check("all-cooling keeps the original order", allCooling.map((entry) => entry.provider), ["gemini", "groq", "huggingface"]);

resetProviderHealth();
check("reset leaves a clean slate", coolingProviders(), []);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
