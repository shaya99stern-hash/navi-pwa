/* Mirrors LEGACY_PRESET_TO_MODE in lib/storage/indexeddb.ts and
   LEGACY_PRESET_MODE in app/api/chat/route.ts. Kept in lockstep. */
type NaviMode = "chat" | "code";

const LEGACY_PRESET_TO_MODE: Record<string, NaviMode> = {
  "navi-code": "code", "navi-soul-deep": "code", "navi-soul": "chat", "navi-soul-direct": "chat",
  "navi-chat": "chat", auto: "chat", "gemini-direct": "chat", "groq-direct": "chat",
  "huggingface-direct": "chat", "navi-5": "code", "fable-5": "code",
  "navi-soul-direct-5-6": "chat", "opus-4-8": "chat", "groq-balanced": "chat",
  "groq-reasoning": "chat", "groq-fast": "chat", "gemini-flash": "chat",
  "openrouter-free": "chat"
};

function normalizeMode(value: unknown, legacyPreset: unknown): NaviMode {
  if (value === "chat" || value === "code") return value;
  return LEGACY_PRESET_TO_MODE[String(legacyPreset ?? "")] ?? "chat";
}

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};

// The rule: anyone on Code keeps Code, everyone else lands on Chat.
check("navi-code keeps Code", normalizeMode(undefined, "navi-code"), "code");
check("navi-soul-deep keeps Code", normalizeMode(undefined, "navi-soul-deep"), "code");
check("navi-soul becomes Chat", normalizeMode(undefined, "navi-soul"), "chat");
check("navi-soul-direct becomes Chat", normalizeMode(undefined, "navi-soul-direct"), "chat");
check("direct routes become Chat", normalizeMode(undefined, "gemini-direct"), "chat");

// Nobody is ever left unset — the whole point of the migration.
for (const value of [undefined, null, "", "something-retired", 42, {}]) {
  check(`unknown (${JSON.stringify(value)}) still lands somewhere`, ["chat", "code"].includes(normalizeMode(undefined, value)), true);
}

// A v4.3.0 preference already carries a mode; trust it over the fallback.
check("an explicit mode wins", normalizeMode("code", "navi-soul"), "code");
check("an explicit chat wins", normalizeMode("chat", "navi-code"), "chat");
check("a bogus mode falls back to the preset", normalizeMode("nonsense", "navi-code"), "code");

// Every preset the app has ever shipped must be covered, not defaulted by luck.
const EVERY_SHIPPED_PRESET = [
  "navi-soul", "navi-code", "auto", "navi-soul-deep", "navi-soul-direct",
  "gemini-direct", "groq-direct", "huggingface-direct", "navi-chat",
  "navi-5", "fable-5", "navi-soul-direct-5-6", "opus-4-8"
];
check("every shipped preset is mapped explicitly",
  EVERY_SHIPPED_PRESET.every((p) => p in LEGACY_PRESET_TO_MODE), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

export {};
