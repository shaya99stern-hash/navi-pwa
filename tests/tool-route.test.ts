import { ROUTES, routeToolCallingSupport, selectDirectRoute } from "@/lib/ai/providers";
import type { ProviderAvailability } from "@/lib/ai/providers";

const all: ProviderAvailability = {
  githubmodels: false,
  gemini: true, groq: true, huggingface: true, cerebras: true, openrouter: true, mistral: true
};
const research = { web: true, code: false, artifacts: true };
const none = { web: false, code: false, artifacts: true };

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${String(actual)}, want ${String(expected)}`}`);
};

// The exact production failure: Navi Soul / Navi Code, Research mode on.
for (const preset of ["navi-soul", "navi-code", "groq-direct"] as const) {
  for (const complex of [false, true]) {
    const route = selectDirectRoute({ preset, availability: all, hasFiles: false, tools: research, complex });
    check(`${preset} complex=${complex} research route accepts tools`, routeToolCallingSupport(route), "custom");
    check(`${preset} complex=${complex} research route is not compound`, /compound/.test(route.model), false);
  }
}

// Tools off still routes fine and is unchanged.
for (const preset of ["navi-soul", "navi-code"] as const) {
  const route = selectDirectRoute({ preset, availability: all, hasFiles: false, tools: none, complex: true });
  check(`${preset} no-tools route resolves`, Boolean(route.model), true);
}

// Hugging Face is still deliberately excluded.
check("hf route sends no tools", routeToolCallingSupport(ROUTES.hfGptOss), "none");
check("gemini route sends tools", routeToolCallingSupport(ROUTES.geminiSynthesis), "custom");
check("cerebras route sends tools", routeToolCallingSupport(ROUTES.cerebrasLarge), "custom");

// The safeguard: an operator pointing GROQ_TOOL_MODEL at compound degrades.
check("compound override degrades to no tools",
  routeToolCallingSupport({ provider: "groq", model: "groq/compound", label: "x", capability: "tools" }), "none");
check("compound-mini override degrades to no tools",
  routeToolCallingSupport({ provider: "groq", model: "groq/compound-mini", label: "x", capability: "tools" }), "none");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
