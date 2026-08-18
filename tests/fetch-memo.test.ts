import { buildWebTools } from "@/lib/ai/web-tools";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── One turn, one read of a URL ─────────────────────────────────────────────
   Production, in a single `/api/chat` request while Navi Soul was reading
   GitHub:

       TimeoutError: The operation was aborted due to timeout   ×10

   Ten fetches of the same reading, twelve seconds apiece — two minutes of a
   four-minute budget spent re-establishing one fact, and the turn died of it.
   The screen showed "NaviOS hit a temporary problem".

   A model re-reading a URL it has already been told about is not being
   unreasonable: "Could not read that page: The operation was aborted due to
   timeout" reads like something that might go differently next time. So the
   fix does not rely on it choosing well — the second read is answered from
   the first. */

async function main() {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;

  const tools = buildWebTools({ search: false });
  const run = (tools.fetch_url as { execute: (i: unknown, o: unknown) => Promise<string> }).execute;
  const url = "https://github.com/example/repo";

  const first = await run({ url }, {} as never);
  const second = await run({ url }, {} as never);
  const third = await run({ url }, {} as never);

  check("a timing-out page is fetched once, not three times", calls, 1);
  check("and the same answer comes back each time", [first === second, second === third], [true, true]);
  check("which still names the timeout", /timeout/i.test(first), true);

  /* A separate turn must be free to try again: a page unreachable a minute ago
     may be fine on the next question. */
  calls = 0;
  const laterTurn = buildWebTools({ search: false });
  await (laterTurn.fetch_url as { execute: (i: unknown, o: unknown) => Promise<string> }).execute({ url }, {} as never);
  check("a later turn tries again rather than inheriting the failure", calls, 1);

  globalThis.fetch = realFetch;
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
void main();
