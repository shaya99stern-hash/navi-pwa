import { read, stripComments } from "./source.mjs";
let pass = 0, fail = 0;
const check = (n, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); };
const catalog = read("lib/ai/provider-catalog.ts").body;
const route = stripComments(read("app/api/connectors/provision/route.ts").source);
check("detection reuses the app's resolver", catalog.includes("providerApiKey(PROVIDERS[adapter])"), true);
/* The aliases are read off the shared credential lists rather than written out
   again. They were the second copy, and they were the copy that disagreed: the
   catalogue accepted three names for GitHub while the resolver gating every
   repository tool accepted a different three, so a deployment set up the way
   this app advises reported GitHub as connected with all of those tools
   missing. */
check("aliases cover the non-model rows", catalog.includes('credentialNames("github")'), true);
check("and are derived rather than restated", catalog.includes('"NAVI_GITHUB_TOKEN"'), false);
check("supabase aliases are covered", catalog.includes("SUPABASE_ANON_KEY"), true);
check("the route no longer checks one exact name", route.includes("Boolean(process.env[entry.envKey]"), false);
check("the route uses shared detection", route.includes("isEntryConfigured(entry)"), true);
console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
