import { fallbackRoutes, ROUTES } from "@/lib/ai/providers";
import type { ProviderAvailability } from "@/lib/ai/providers";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};
const all: ProviderAvailability = { gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true, mistral: true, deepseek: true };

// The live failure: Gemini answers 403, four other providers are configured.
const afterGemini = fallbackRoutes({ primary: ROUTES.geminiSynthesis, availability: all, complex: false });
check("gemini 403 falls back", afterGemini.length, 2);
check("never retries the same provider", afterGemini.some((r) => r.provider === "gemini"), false);
check("alternates are on distinct providers", new Set(afterGemini.map((r) => r.provider)).size, afterGemini.length);

// Every primary provider gets alternates.
for (const route of [ROUTES.groqFast, ROUTES.cerebrasLarge, ROUTES.mistralBalanced, ROUTES.hfGptOss, ROUTES.openRouterCoding]) {
  const alts = fallbackRoutes({ primary: route, availability: all, complex: true });
  check(`${route.provider} has alternates`, alts.length > 0, true);
  check(`${route.provider} excludes itself`, alts.some((r) => r.provider === route.provider), false);
}

// Only one provider configured: nothing to fall back to, and no crash.
const onlyGemini: ProviderAvailability = { gemini: true, groq: false, huggingface: false, cerebras: false, openrouter: false, mistral: false, deepseek: false };
check("single provider yields no alternates", fallbackRoutes({ primary: ROUTES.geminiSynthesis, availability: onlyGemini, complex: false }), []);

// Effort is respected in the alternate, not just the primary.
const lowAlts = fallbackRoutes({ primary: ROUTES.geminiSynthesis, availability: all, complex: false });
const highAlts = fallbackRoutes({ primary: ROUTES.geminiSynthesis, availability: all, complex: true });
check("low effort picks the fast groq route", lowAlts[0].model, ROUTES.groqFast.model);
check("high effort picks the reasoning route", highAlts[0].model, ROUTES.groqReasoning.model);

// Bounded: a third attempt costs more latency than it recovers.
check("at most two alternates", fallbackRoutes({ primary: ROUTES.hfGptOss, availability: all, complex: true }).length <= 2, true);
// Every alternate must accept tools when the primary did, or the tool bug returns.
check("alternates are tool-capable providers", afterGemini.every((r) => r.provider !== "huggingface"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
