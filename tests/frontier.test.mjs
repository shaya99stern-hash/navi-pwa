import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const providers = read("lib/ai/providers.ts").body;
const diagnostics = read("lib/ai/diagnostic-tools.ts").body;

/* ── The one route that raises the ceiling ────────────────────────────────
   Every other route is a fast open-weight host, and no amount of prompting
   turns one of those into a frontier model: answer quality is bounded by which
   model answers, not by how much it is told. This is the only lever that moves
   that bound rather than using it better. */

check("a frontier route exists", providers.includes("openRouterFrontier"), true);
check("the model is named by the deployment", /NAVI_FRONTIER_MODEL/.test(providers), true);
/* It must default to absent. This is the only route that can bill per request,
   and an app that silently starts spending because it was upgraded is a worse
   failure than one that answers slightly less well. */
check("it is off unless a model is named",
  /model: process\.env\.NAVI_FRONTIER_MODEL \?\? ""/.test(providers), true);
check("one predicate decides whether it is configured",
  /export function frontierConfigured\(\)/.test(providers), true);

/* ── It may only be reached on the lane that means "this is hard" ───────── */

check("escalation is gated on the lane's own budget check",
  /if \(frontierConfigured\(\) && availability\.openrouter && meteredAllowed\) return ROUTES\.openRouterFrontier;/.test(providers), true);
/* Lane 3 is high effort or complex work. Escalating anywhere else would spend
   frontier money on "what is 15% of 200". */
const laneThreeAt = providers.indexOf("if (lane === 3)");
const frontierAt = providers.indexOf("return ROUTES.openRouterFrontier");
check("it lives inside lane 3", laneThreeAt > 0 && frontierAt > laneThreeAt, true);
/* A spent budget must degrade to a good free answer, not to an apology. */
check("the free routes still follow it",
  /return ROUTES\.openRouterFrontier;[\s\S]{0,400}availability\.cerebras\) return ROUTES\.cerebrasLarge/.test(providers), true);
/* An unnamed model must be unreachable by any other path — an empty model id
   sent to a provider is a request that fails for a reason nobody can read. */
check("the frontier route is not in the blind fallback chain",
  /routes\.push\(ROUTES\.openRouterFrontier\)/.test(providers), false);

/* ── Silent by nature, so it must be reportable ──────────────────────────
   No model named, no OpenRouter key, or no durable spend store: three causes,
   one indistinguishable symptom — a good answer where a better one was
   available. Nobody would ever notice without being told. */
check("diagnostics report escalation", diagnostics.includes("Frontier escalation"), true);
/* "Set but unreachable" is the interesting half: a model named with no key
   behind it escalates nothing and says nothing. The message used to assert
   there was no `OPENROUTER_API_KEY` by that exact name, which was a second
   claim it could not support — the router accepts several spellings, so a
   deployment using one of the others was told it had no key while the key
   worked. The check reads the registry now and the sentence says what it
   knows. */
check("they distinguish unset from unreachable",
  /NAVI_FRONTIER_MODEL is set to[\s\S]{0,80}no OpenRouter key is configured/.test(diagnostics), true);
check("and still names the variable to set", /Set OPENROUTER_API_KEY/.test(diagnostics), true);
check("the check asks the registry rather than one name",
  /providerApiKey\(PROVIDERS\.openrouter\)/.test(diagnostics), true);
check("they name the cost, since it is the reason it is off",
  /costs money per request/.test(diagnostics), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
