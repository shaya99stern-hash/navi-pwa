import { MAX_PREAMBLE_CHUNKS, readUntilCommitted, type StreamChunk } from "@/lib/ai/lane-commit";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

function readerOf(chunks: StreamChunk[]): ReadableStreamDefaultReader<unknown> {
  return new ReadableStream<StreamChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  }).getReader();
}

async function main() {
  /* The live failure. `start` arrives before the provider has committed to
     anything, so committing on the first chunk showed an error card while two
     healthy lanes sat unused. Every one of these must fall through. */
  for (const [name, text] of [
    ["rate limit", "Navi Soul is busy right now. Try again in a moment."],
    ["auth 403", "Navi Soul is not configured correctly. Check the provider keys in Settings."],
    ["timeout", "Navi Soul took too long on that. Try again, or lower the effort."],
    ["generic 5xx", "Navi Soul could not complete the response. Please try again."]
  ] as const) {
    const result = await readUntilCommitted(readerOf([
      { type: "start" },
      { type: "start-step" },
      { type: "error", errorText: text }
    ]));
    check(`${name} before content does not commit`, result.committed, false);
    check(`${name} reports why`, result.failure?.message, text);
  }

  // A lane that hands back nothing at all is a failure, not an empty answer.
  const closed = await readUntilCommitted(readerOf([{ type: "start" }]));
  check("silent close does not commit", closed.committed, false);
  check("silent close reports why", closed.failure?.message, "The provider closed without answering.");

  // An error part with no text still has to produce a usable failure.
  const blank = await readUntilCommitted(readerOf([{ type: "error", errorText: "" }]));
  check("blank error still fails", blank.committed, false);
  check("blank error has a message", Boolean(blank.failure?.message), true);

  /* Once real text arrives the lane is committed: retrying past this point
     would replay a partial reply on top of what the reader already saw. */
  const streamed = await readUntilCommitted(readerOf([
    { type: "start" },
    { type: "start-step" },
    { type: "text-start" },
    { type: "text-delta" },
    { type: "error", errorText: "died mid-stream" }
  ]));
  check("text commits the lane", streamed.committed, true);
  check("commit reports no failure", streamed.failure, null);
  check("preamble is replayed in full", streamed.preamble.map((c) => c.type), ["start", "start-step", "text-start", "text-delta"]);

  // A tool call is content too — a lane that starts working has committed.
  const tooling = await readUntilCommitted(readerOf([
    { type: "start" },
    { type: "tool-input-start" }
  ]));
  check("tool call commits the lane", tooling.committed, true);

  // A lane that only ever emits preamble is delivered rather than discarded.
  const chatty = await readUntilCommitted(readerOf(
    Array.from({ length: MAX_PREAMBLE_CHUNKS + 4 }, () => ({ type: "start-step" }))
  ));
  check("preamble cap commits", chatty.committed, true);
  check("preamble cap stops reading at the cap", chatty.preamble.length, MAX_PREAMBLE_CHUNKS);

}

main().then(() => {
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}).catch((error) => {
  /* Without this a rejected promise leaves the exit code at 0 and the runner
     reports a silent pass. */
  console.error(error);
  process.exit(1);
});

