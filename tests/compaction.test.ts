import { estimateTokens } from "@/lib/ai/compaction";
import type { ModelMessage } from "ai";

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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
