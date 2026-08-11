import { engineName } from "@/lib/ai/providers";
import { tidyTitle } from "@/lib/ai/title";
import type { ProviderRoute } from "@/lib/ai/types";

/**
 * Two gaps from the parity audit, both of which the app had the information
 * to close and simply never said out loud.
 *
 * The routing matrix picks between a dozen models by difficulty, attachments,
 * tool need and provider health, and every reply looked identical whichever it
 * chose. And the history drawer titled each chat with the first seven words of
 * the question, which is a list of truncated openings precisely when there are
 * enough chats to need a list.
 */

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const route = (capability: ProviderRoute["capability"], provider: ProviderRoute["provider"] = "groq"): ProviderRoute =>
  ({ provider, model: "some-model-id", label: "Internal Label", capability });

/* ── An engine is named for what it does, never for who built it ─────────── */

check("the fast lane has a Navi name", engineName(route("fast")), "Navi Swift");
check("the reasoning lane has its own", engineName(route("reasoning")), "Navi Deep");
check("long context is distinguishable", engineName(route("long-context")), "Navi Wide");
check("so is vision", engineName(route("multimodal")), "Navi Vision");
check("and coding", engineName(route("coding")), "Navi Code");

/* The house rule, and the reason for it: no user-visible surface in this app
   names a third party, and the system prompt forbids the model from doing it
   either. A badge that leaked "Groq" would contradict the answer above it. */
const everyCapability: Array<ProviderRoute["capability"]> =
  ["fast", "balanced", "reasoning", "multimodal", "tools", "long-context", "coding"];
const allNames = everyCapability.map((capability) => engineName(route(capability)));
check("every capability resolves to a name", allNames.every(Boolean), true);
check("and every name is Navi-branded", allNames.every((name) => name.startsWith("Navi ")), true);
const providerWords = /groq|gemini|cerebras|openrouter|deepseek|mistral|together|nvidia|sambanova|hugging|llama|qwen|gpt|claude/i;
check("no engine name leaks a provider or a model family",
  allNames.some((name) => providerWords.test(name)), false);

/* The metered route is named apart from its capability, because it is the one
   route that is categorically different — a user seeing it should be able to
   tell they are on the one that can cost money. */
process.env.NAVI_FRONTIER_MODEL = "anthropic/claude-opus-5";
check("the frontier route is named as itself",
  engineName({ provider: "openrouter", model: "anthropic/claude-opus-5", label: "Navi Soul frontier", capability: "reasoning" }),
  "Navi Frontier");
/* A free OpenRouter route must not be mistaken for it. */
check("but an ordinary route on the same provider is not",
  engineName({ provider: "openrouter", model: "deepseek/deepseek-r1:free", label: "OpenRouter reasoning", capability: "reasoning" }),
  "Navi Deep");
delete process.env.NAVI_FRONTIER_MODEL;
check("and with no frontier configured it stays a capability name",
  engineName({ provider: "openrouter", model: "", label: "Navi Soul frontier", capability: "reasoning" }),
  "Navi Deep");

/* ── A title goes straight into a list, so it is tidied rather than trusted ─ */

check("an ordinary title passes through", tidyTitle("Parsing ISO dates in Safari"), "Parsing ISO dates in Safari");
check("quotes are stripped", tidyTitle('"Parsing ISO dates"'), "Parsing ISO dates");
check("curly quotes too", tidyTitle("“Parsing ISO dates”"), "Parsing ISO dates");
check("a label prefix is stripped", tidyTitle("Title: Parsing ISO dates"), "Parsing ISO dates");
check("trailing punctuation goes", tidyTitle("Parsing ISO dates."), "Parsing ISO dates");
check("whitespace is collapsed", tidyTitle("  Parsing   ISO\n dates "), "Parsing ISO dates");
check("it is sentence-cased", tidyTitle("parsing ISO dates"), "Parsing ISO dates");

/* Refused rather than cut. A truncated sentence reads as a bug; the heuristic
   title it falls back to reads as a title, so the fallback is the better
   outcome whenever the model ignored the instruction. */
check("a model that wrote a sentence is refused",
  tidyTitle("The user is asking about how to parse ISO dates in Safari and wants an example"), null);
check("so is anything past eight words",
  tidyTitle("One two three four five six seven eight nine"), null);
check("and empty output", tidyTitle("   "), null);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
