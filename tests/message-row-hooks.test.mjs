import { read } from "./source.mjs";

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const { body } = read("app/components/message-row.tsx");
const emptyReturn = body.indexOf("if (!text && files.length === 0 && !streaming) return null;");
const spokenRef = body.indexOf("const spoken = useRef<SpokenHandle | null>(null);");

check("the tool-only row guard exists", emptyReturn >= 0, true);
check("every message-row hook is declared before the tool-only early return", spokenRef >= 0 && spokenRef < emptyReturn, true);

process.exitCode = failed ? 1 : 0;
