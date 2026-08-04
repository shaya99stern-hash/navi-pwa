import { selectLane } from "@/lib/ai/providers";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};
const lane = (o: Partial<Parameters<typeof selectLane>[0]> = {}) => selectLane({
  mode: "chat", effort: "medium", complex: false, hasFiles: false, longContext: false, ...o
});

// Attachments are a capability requirement, and outrank every other signal.
check("a file forces the multimodal lane", lane({ hasFiles: true, effort: "high" }), 2);
check("a file beats long context", lane({ hasFiles: true, longContext: true }), 2);

// Long context is a context problem, not a reasoning one — Lane 3 caps at 8K.
check("long context takes lane 4", lane({ longContext: true, effort: "high" }), 4);

// Lane 3 is rationed: it must be earned, not handed out.
check("high effort earns lane 3", lane({ effort: "high" }), 3);
check("hard code earns lane 3", lane({ mode: "code", complex: true }), 3);
check("ordinary chat does not", lane(), 2);
check("a low-effort follow-up does not", lane({ effort: "low" }), 1);
check("simple code work does not", lane({ mode: "code" }), 4);
check("complex chat at medium earns it", lane({ complex: true }), 3);

// Code mode biases toward 3 and 4; chat mode toward 1 and 2.
for (const effort of ["low", "medium"] as const) {
  check(`code mode at ${effort} avoids the fast lane`, lane({ mode: "code", effort }) >= 3, true);
}
check("chat mode at low is the fast lane", lane({ mode: "chat", effort: "low" }), 1);

// Every combination must yield a real lane — no undefined path.
for (const mode of ["chat", "code"] as const) {
  for (const effort of ["low", "medium", "high"] as const) {
    for (const complex of [true, false]) {
      for (const hasFiles of [true, false]) {
        for (const longContext of [true, false]) {
          const value = selectLane({ mode, effort, complex, hasFiles, longContext });
          if (![1, 2, 3, 4].includes(value)) { fail++; console.log(`FAIL  ${mode}/${effort} produced ${value}`); }
        }
      }
    }
  }
}
check("every combination yields a lane", true, true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
