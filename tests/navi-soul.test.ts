/* PATH: tests/navi-soul.test.ts  — NEW FILE, copy verbatim.
   Runs under the existing harness: `npm test` (tests/run.mjs). */

const {
  calculate, executeSystemCommand, isBasicMath, isSystemCommand, LOCAL_COMMANDS
} = require("../lib/ai/navi-soul/local-processor") as typeof import("../lib/ai/navi-soul/local-processor");
const { decideLocally } = require("../lib/ai/navi-soul/router") as typeof import("../lib/ai/navi-soul/router");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

async function main() {
  /* ---- Arithmetic is parsed, never executed -------------------------- */
  check("a sum is recognised", isBasicMath("2 + 2"), true);
  check("a bare number is not a sum", isBasicMath("7"), false);
  check("prose is not a sum", isBasicMath("what is 2 + 2"), false);
  /* The whole reason this module exists: none of these may reach an evaluator. */
  check("a function call is not a sum", isBasicMath("fetch('/x')"), false);
  check("an identifier is not a sum", isBasicMath("process.env.KEY"), false);
  check("a template is not a sum", isBasicMath("`${1}`"), false);

  check("addition", calculate("2+2").handledLocally && (calculate("2+2") as { response: string }).response, "2+2 = 4");
  check("precedence holds", (calculate("2 + 3 * 4") as { response: string }).response, "2 + 3 * 4 = 14");
  check("parentheses hold", (calculate("(2 + 3) * 4") as { response: string }).response, "(2 + 3) * 4 = 20");
  check("unary minus", (calculate("-5 + 2") as { response: string }).response, "-5 + 2 = -3");
  check("exponent is right-associative", (calculate("2^3^2") as { response: string }).response, "2^3^2 = 512");
  /* Correct and useless is still useless. */
  check("float noise is presented, not printed", (calculate("0.1 + 0.2") as { response: string }).response, "0.1 + 0.2 = 0.3");
  /* A miss goes to the model rather than answering Infinity. */
  check("division by zero is a miss", calculate("1/0").handledLocally, false);
  check("an unbalanced paren is a miss", calculate("(1+2").handledLocally, false);
  check("a malformed number is a miss", calculate("1.2.3+1").handledLocally, false);

  /* ---- Commands report state rather than asserting it ---------------- */
  check("commands are recognised", LOCAL_COMMANDS.every((c) => isSystemCommand(c)), true);
  check("case does not matter", isSystemCommand("/PING"), true);
  check("ping when online", (executeSystemCommand("/ping", { online: true }) as { response: string }).response, "Online.");
  check("ping when offline names the fallback", /Saved chats/.test((executeSystemCommand("/ping", { online: false }) as { response: string }).response), true);
  /* No route list means no claim about routes — the constitution's first rule. */
  check("models with no known routes is a miss", executeSystemCommand("/models", {}).handledLocally, false);
  check("models lists what it was given", (executeSystemCommand("/models", { routes: ["a", "b"] }) as { response: string }).response, "Available: a, b.");
  check("status does not invent route counts", /unknown/.test((executeSystemCommand("/status", { version: "1" }) as { response: string }).response), true);

  /* ---- The gate --------------------------------------------------- */
  check("a sum never reaches a model", decideLocally("12*12").route, "local");
  check("a question always does", decideLocally("why is the sky blue").route, "model");
  check("empty input goes to the model", decideLocally("   ").route, "model");
  check("clear is the client's to perform", decideLocally("/clear"), { route: "client-command", command: "/clear" });

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });

export {};
