const serverOnly2 = require.resolve("server-only");
require.cache[serverOnly2] = { id: serverOnly2, filename: serverOnly2, loaded: true, exports: {} } as unknown as NodeModule;

const { looksDurable, parseFacts } = require("../lib/memory/extract") as typeof import("../lib/memory/extract");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* The gate decides whether a model reads the message at all. Its bias is the
   opposite of `needsAppKnowledge`: a false positive costs a call and possibly a
   junk row that then pollutes every later turn, while missing a fact is cheap
   because the person will say it again. Strict, not generous. */
for (const text of [
  "I always want answers in metric",
  "I'm a nurse in Toronto",
  "I use TypeScript for everything",
  "my timezone is Eastern",
  "I prefer short replies",
  "remember that I bill hourly",
  "from now on skip the preamble",
  "I never want emoji in code comments",
  /* Found by a real user, missed by the first version of this list. "like" was
     not among the preference verbs and "save to memory" was not among the
     instructions, so someone asking in as many words to have something
     remembered was turned away before a model ever read it. */
  "I like honesty can you save to memory",
  "I like short answers",
  "save this to memory",
  "add that to your memory",
  "note that I bill hourly",
  "don't forget I work weekends",
  "I value directness over politeness",
  "I live in Toronto",
  "I speak Hebrew at home",
  "I need you to never use emoji"
]) check(`considered: ${text}`, looksDurable(text), true);

/* Ordinary requests must not reach the model. These are the overwhelming
   majority of turns, and each one waved through is a wasted call. */
for (const text of [
  "can you fix this null check",
  "what is 12% of 4300",
  "write me a haiku",
  "list my repos",
  "why is the build failing",
  "thanks",
  "ok"
]) check(`skipped: ${text}`, looksDurable(text), false);

check("something too short is skipped", looksDurable("I use it"), false);
check("an empty message is skipped", looksDurable(""), false);
/* A long paste is a document, not a statement about the person. */
check("a very long message is skipped", looksDurable(`I use ${"x".repeat(2100)}`), false);

/* ---- Reading the model's reply -------------------------------------- */

check("a plain array parses", parseFacts('["Works as a nurse", "Based in Toronto"]'), ["Works as a nurse", "Based in Toronto"]);
/* A fence around JSON is the normal case, not the exception. */
check("a fenced array parses", parseFacts('```json\n["Prefers metric units"]\n```'), ["Prefers metric units"]);
check("surrounding prose is tolerated", parseFacts('Here you go: ["Prefers metric units"] — hope that helps'), ["Prefers metric units"]);

/* Both "nothing to remember" and "unparseable" must yield no rows. Either one
   becoming a stored fact is how a memory fills with garbage. */
check("an empty array yields nothing", parseFacts("[]"), []);
check("prose with no array yields nothing", parseFacts("There is nothing durable here."), []);
check("malformed JSON yields nothing", parseFacts('["unterminated'), []);
check("a JSON object yields nothing", parseFacts('{"fact":"Works as a nurse"}'), []);
check("an empty reply yields nothing", parseFacts(""), []);

/* Two words is noise; several sentences is a summary of the conversation
   rather than a fact about the person. */
check("a two-word fact is dropped", parseFacts('["uses ts"]'), []);
check("an essay is dropped", parseFacts(`["${"long ".repeat(60)}"]`), []);
check("non-strings are dropped", parseFacts('["Works as a nurse", 42, null]'), ["Works as a nurse"]);
check("at most three per turn", parseFacts('["Fact one here","Fact two here","Fact three here","Fact four here"]').length, 3);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
