import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildConnectorTools } from "@/lib/ai/connector-tools";
import { buildToolset, type ToolsetContext } from "@/lib/tools/registry";
import type { CustomConnector } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const connector = (overrides: Partial<CustomConnector>): CustomConnector => ({
  id: "c1", kind: "openai", name: "My API", baseUrl: "https://api.example.com/v1", apiKey: "k", ...overrides
});

/* ── The tool exists exactly when it can do something ───────────────────── */

check("no connectors, no tool", "use_connector" in buildConnectorTools({ connectors: [] }), false);
check("an ai connector yields the tool", "use_connector" in buildConnectorTools({ connectors: [connector({})] }), true);
check("a supabase connector yields the tool", "use_connector" in buildConnectorTools({ connectors: [connector({ kind: "supabase" })] }), true);
check("mcp-kind connectors alone yield no tool", "use_connector" in buildConnectorTools({ connectors: [connector({ kind: "mcp" })] }), false);

const roster = buildConnectorTools({ connectors: [connector({ name: "DeepSeek" }), connector({ id: "c2", kind: "supabase", name: "My DB", baseUrl: "https://x.supabase.co" })] });
const rosterDescription = String(roster.use_connector?.description ?? "");
check("the tool names every connector", rosterDescription.includes("DeepSeek") && rosterDescription.includes("My DB"), true);

/* ── Registry integration ───────────────────────────────────────────────── */

const context = (customConnectors: CustomConnector[]): ToolsetContext => ({
  mode: "chat",
  policy: { web: false, code: false, artifacts: true },
  signal: new AbortController().signal,
  customConnectors
});

check("the registry offers user connectors", "use_connector" in buildToolset(context([connector({})])), true);
check("the registry omits the tool without connectors", "use_connector" in buildToolset(context([])), false);

/* ── The chat route gates on access mode and validates shape ────────────── */

const routeSource = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
check("ask mode sends no custom connectors", routeSource.includes('connectorAccessMode === "ask" ? [] : parseCustomConnectors'), true);
check("only https connectors are accepted", routeSource.includes('connector.baseUrl.startsWith("https://")'), true);

const toolsSource = readFileSync(join(process.cwd(), "lib/ai/connector-tools.ts"), "utf8");
check("connector urls pass the ssrf guard", toolsSource.includes("assertFetchableUrl"), true);
check("supabase table names are validated", toolsSource.includes("That table name is not valid."), true);

/* ── The sheet uses a drop-down, per the product constraint ─────────────── */

const sheetSource = readFileSync(join(process.cwd(), "app/components/connectors-sheet.tsx"), "utf8");
check("the add flow is a select drop-down", sheetSource.includes("<select"), true);
check("all four kinds are offered", ["openai", "anthropic", "supabase", "mcp"].every((kind) => sheetSource.includes(`"${kind}"`)), true);
check("connectors are tested before being added", sheetSource.includes("/api/connectors/test"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
