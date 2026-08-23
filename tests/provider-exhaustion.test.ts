import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coolingProviders, exhaustedProviders, isBudgetExhausted, isCredentialRejection,
  markProviderFailure, markProviderSuccess, orderRoutesByHealth, rejectedProviders, resetProviderHealth
} from "@/lib/ai/provider-health";
import type { ProviderRoute } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Out of credits is a third thing ─────────────────────────────────────────
   An audit found a Hugging Face account with its monthly credits spent:

     "You have depleted your monthly included credits. Purchase pre-paid credits
      to continue using Inference Providers."

   The token is valid, so it is not a rejection. It will not clear in thirty
   seconds, so it is not a cooldown. And roughly twelve of this app's routes are
   Hugging Face — so every turn walked all twelve, collected twelve identical
   402s, and spent its whole retry budget learning what the first one said. */

const depleted = new Error("AI_APICallError: 402 You have depleted your monthly included credits.");

check("a 402 is exhaustion", isBudgetExhausted(depleted), true);
check("and is not a dead key", isCredentialRejection(depleted), false);
check("payment required, in words", isBudgetExhausted(new Error("Payment Required")), true);
check("and OpenRouter's phrasing for the same thing",
  isBudgetExhausted(new Error("This request requires more credits, or fewer max_tokens")), true);

/* The two that must never be read as exhaustion. Being rate-limited is proof
   the account is fine, and a dead key needs a person, not a top-up. */
check("a rate limit is not exhaustion", isBudgetExhausted(new Error("429 Too Many Requests")), false);
check("nor is a refused key", isBudgetExhausted(new Error("401 Unauthorized")), false);
check("nor is nothing at all", isBudgetExhausted(undefined), false);

/* ── One 402 is enough ────────────────────────────────────────────────────── */

resetProviderHealth();
markProviderFailure("huggingface", depleted);
check("a single 402 marks the provider exhausted", exhaustedProviders(), ["huggingface"]);
/* Immediately, like a rejection and for the same reason: the provider has
   already said plainly what a second request would only confirm. */
check("and it starts cooling at once rather than after a second failure",
  coolingProviders(), ["huggingface"]);
check("without being mistaken for a dead key", rejectedProviders(), []);

/* The property this exists for: twelve HF routes go to the back, so the turn
   stops paying to rediscover the same 402 eleven more times. */
const route = (provider: string, model: string) => ({ provider, model, label: model, capability: "reasoning" } as unknown as ProviderRoute);
const ordered = orderRoutesByHealth([
  route("huggingface", "hf-a"), route("groq", "groq-a"), route("huggingface", "hf-b")
]);
check("an exhausted provider's routes are moved behind the healthy ones",
  ordered.map((entry) => entry.model), ["groq-a", "hf-a", "hf-b"]);
/* Never dropped. If everything is exhausted, everything is still tried — a
   guess beats a guaranteed refusal. */
check("but nothing is made unreachable", ordered.length, 3);

/* A top-up clears it on the first real use, like a replaced key. */
markProviderSuccess("huggingface");
check("a successful call clears the record", exhaustedProviders(), []);
resetProviderHealth();

/* ── Said where the model can read it ────────────────────────────────────── */

const environment = readFileSync(join(process.cwd(), "lib/ai/environment-tools.ts"), "utf8");
check("the environment tool reports exhaustion", /exhaustedProviders\(\)/.test(environment), true);
check("apart from failure, because the remedy differs",
  environment.includes("Out of credits, not broken:"), true);
check("and tells the model not to call it a failure",
  environment.includes("Say that rather than calling them failures"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
