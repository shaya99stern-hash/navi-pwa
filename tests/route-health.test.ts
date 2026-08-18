import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearCatalogCache } from "@/lib/ai/catalog";
import { catalogueModelIds, knownCatalogues, modelResolves, recordCatalogue } from "@/lib/ai/route-health";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── A working key has never proved the model behind it exists ───────────────
   `providerProbes` validates a credential, which is the smaller half of the
   question. Nothing on the answer path checked that a route's model id still
   resolves — so a retired, renamed or never-shipped id 404s, the failure is
   swallowed by the silent-failover design, and the turn quietly degrades to
   whatever answers next.

   That is correct behaviour toward the user and it made the rot invisible from
   the inside: an audit of the routing table found several ids that appear never
   to have existed, and nothing had ever noticed, because nothing was looking. */

clearCatalogCache();

check("nothing is known before anything is looked up", modelResolves("groq", "some-model"), null);

recordCatalogue("groq", new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]));
check("a listed model resolves", modelResolves("groq", "openai/gpt-oss-120b"), true);
check("an unlisted one does not", modelResolves("groq", "openai/gpt-oss-999b"), false);
/* Knowing about one provider says nothing about another. */
check("a provider nobody asked about stays unknown", modelResolves("cerebras", "llama-3.3-70b"), null);

recordCatalogue("cerebras", new Set(["llama-3.3-70b"]));
check("and both are remembered at once", Object.keys(knownCatalogues()).sort(), ["cerebras", "groq"]);

/* ── Unknown must never mean dead ────────────────────────────────────────────
   The inverse of the rule the spend ledger follows. An unreadable ledger reads
   as *spent*, because over-counting cannot overspend. An unreadable catalogue
   must read as *fine*, because treating no-evidence as dead would let one
   provider's listing endpoint having a bad afternoon disable every route it
   serves — a self-inflicted outage on the strength of nothing. */
recordCatalogue("mistral", new Set());
check("an empty listing is not recorded as proof of absence",
  modelResolves("mistral", "mistral-large-latest"), null);
check("and does not appear as knowledge", "mistral" in knownCatalogues(), false);

/* ── Reading a catalogue ─────────────────────────────────────────────────── */

check("OpenAI-shaped listings parse",
  [...catalogueModelIds({ data: [{ id: "a" }, { id: "b" }] })].sort(), ["a", "b"]);
/* Google prefixes every id with `models/` and the routes hold the bare id. */
check("Google-shaped listings parse, without the prefix",
  [...catalogueModelIds({ models: [{ name: "models/gemini-2.5-flash" }] })], ["gemini-2.5-flash"]);
check("junk parses to nothing rather than throwing", catalogueModelIds("nope").size, 0);
check("and so does null", catalogueModelIds(null).size, 0);

clearCatalogCache();

/* ── The production wiring ───────────────────────────────────────────────── */

const root = process.cwd();
const orchestrator = readFileSync(join(root, "lib/ai/navi-soul/orchestrator.ts"), "utf8");
const route = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const discovery = readFileSync(join(root, "lib/ai/model-discovery.ts"), "utf8");

check("the plan drops routes known to be dead",
  /orderRoutesByHealth\(\s*withoutDeadModels\(\[/.test(orchestrator), true);
/* Only a hard false removes anything. */
check("and only on a confirmed answer",
  /modelResolves\(route\.provider, baseModelId\(route\.model\)\) !== false/.test(orchestrator), true);
/* A turn answered by a probably-dead route still beats a turn with nowhere to
   go. This spares the failover work; it does not replace it. */
check("never leaving the turn with nowhere to go",
  /return alive\.length \? alive : routes;/.test(orchestrator), true);

check("the answer path warms it without waiting",
  /refreshRouteHealth\(request\.signal\);/.test(route), true);
check("and the refresher is silent about its own failures",
  /\}\)\(\)\.catch\(\(\) => \{\}\);/.test(discovery), true);
/* One parser for both readers of the same payload. */
check("the diagnostics and the router read catalogues the same way",
  /catalogueModelIds/.test(readFileSync(join(root, "lib/ai/diagnostic-tools.ts"), "utf8")), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
