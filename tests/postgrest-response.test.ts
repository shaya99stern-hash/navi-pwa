import { readPostgrestPayload } from "@/lib/memory/postgrest-response";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
}

async function main() {
  check("204 is a successful empty response", await readPostgrestPayload(new Response(null, { status: 204 })), null);
  check("200 with no body is also successful", await readPostgrestPayload(new Response(null, { status: 200 })), null);
  check("whitespace-only success is empty", await readPostgrestPayload(new Response("  \r\n", { status: 200 })), null);
  check("JSON success is parsed", await readPostgrestPayload(new Response('{"saved":true}', { status: 200 })), { saved: true });

  let rejected = false;
  try {
    await readPostgrestPayload(new Response("not json", { status: 200 }));
  } catch {
    rejected = true;
  }
  check("a non-empty malformed body still reports a real failure", rejected, true);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
