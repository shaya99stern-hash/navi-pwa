import { estimateTokens } from "@/lib/ai/compaction";
import type { ModelMessage } from "ai";
import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};
const say = (content: string): ModelMessage => ({ role: "user", content });

check("empty conversation costs nothing", estimateTokens([]), 0);
check("four characters is about one token", estimateTokens([say("abcd")]), 1);
check("length accumulates across turns", estimateTokens([say("abcd"), say("efgh")]), 2);
// The estimate must never under-report, or a request sails past the cap.
check("a partial token rounds up", estimateTokens([say("abcde")]), 2);

// Structured content still has to be counted; ignoring it under-reports badly.
const withParts: ModelMessage = { role: "user", content: [{ type: "text", text: "x".repeat(400) }] };
check("multi-part content is counted", estimateTokens([withParts]) > 90, true);

// The guard that matters: an 8K cap must reject a conversation that exceeds it.
const long = Array.from({ length: 40 }, () => say("y".repeat(1_000)));
check("a long conversation exceeds the Lane 3 cap", estimateTokens(long) > 8_000, true);
check("a short one does not", estimateTokens([say("hello there")]) < 8_000, true);

/* Recency is kept verbatim: the turns most likely to matter are the ones just
   said, and compressing those trades away the load-bearing context. */
const VERBATIM_TURNS = 6;
const cutoff = (count: number) => count - VERBATIM_TURNS;
check("six recent turns survive a 40-turn chat", 40 - cutoff(40), 6);
check("the split leaves the rest to summarise", cutoff(40), 34);
// Too short to split is left alone rather than summarised into nothing.
check("a 7-turn chat is not worth splitting", 7 <= VERBATIM_TURNS + 1, true);
check("an 8-turn chat is", 8 <= VERBATIM_TURNS + 1, false);

/* The bug this section exists for: `compactForBudget` was written, tested, and
   imported by nothing but this file. The chat route even carried a comment
   describing the compaction it was supposed to perform, three lines above code
   that handed `streamText` the raw conversation. Every assertion above passed
   the whole time, because a module can be perfectly correct and still never
   run. So assert the wiring, not just the arithmetic. */
const { body } = read("app/api/chat/route.ts");

check("the route imports the compactor", body.includes("compactForBudget"), true);
check("the compactor is called, not just imported", /compactForBudget\(\{/.test(body), true);

/* Scoped to the streamText call rather than the whole file. `messages:
   modelMessages` legitimately appears twice more — as the compactor's own
   input, and in the swarm path, which routes separately — so a file-wide
   absence check fails for a reason that is not the bug. That is the same
   shape-instead-of-fact mistake these helpers exist to prevent. */
const streamCall = body.slice(body.indexOf("const result = streamText({"));
const streamArgs = streamCall.slice(0, streamCall.indexOf("\n      });"));
check("the streamText call was located", streamArgs.length > 0 && streamArgs.length < 4_000, true);
check("streamText is not handed the raw conversation", /messages:\s*modelMessages/.test(streamArgs), false);
/* The fitted conversation now reaches the model through the preflight, which
   may truncate it further to fit the route's own ceiling but can only ever be
   handed what the compactor already produced. Both halves are checked, because
   a preflight fed the raw conversation would pass the first on its own. */
check("streamText receives the fitted conversation", /messages:\s*flight\.messages/.test(streamArgs), true);
check("the preflight is handed the compacted conversation",
  /preflightPayload\(\{[\s\S]{0,400}?messages:\s*attemptMessages/.test(body), true);

/* Budgeted per attempt, because the window is a property of the model. A
   fallback lane can be far smaller than the primary, and compacting once to
   the primary's budget hands the fallback an input it cannot take. */
check("the budget comes from the attempt's own provider", /PROVIDERS\[attempt\.provider\]\.contextWindow/.test(body), true);
check("the conversation is budgeted below the full window", body.includes("CONTEXT_INPUT_SHARE"), true);
check("the compaction is memoised by budget", body.includes("compactionCache"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
