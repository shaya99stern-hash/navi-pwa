import { read } from "./source.mjs";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const settings = read("app/components/settings-sheet.tsx").source;
const connectors = read("app/components/connectors-sheet.tsx").source;
const css = read("app/settings-claude.css").source;

check("settings keeps a page history", settings.includes("pageHistory.current.push(page)"), true);
check("back pops exactly one level", settings.includes('const previous = pageHistory.current.pop() ?? "root"'), true);
check("back uses the stack helper", /onClick=\{goBack\}[\s\S]{0,90}aria-label="Back to Settings"/.test(settings), true);
check("opening Connectors does not close Settings underneath", settings.includes("onClose(); onOpenConnectors();"), false);
check("settings tracks the open transition", settings.includes("wasOpen.current"), true);
check("theme is applied before the preference update", settings.includes("applyThemeBeforePreferenceUpdate"), true);
check("profile title does not fall back to account email", /profileName[\s\S]{0,200}\|\| account\.email/.test(settings), false);
check("Apple account imitation is gone", settings.includes("Apple Account, iCloud"), false);
check("select values truncate", settings.includes('className="min-w-0 truncate"'), true);
check("select values have a mobile max width", settings.includes("max-w-[48vw]"), true);
check("settings switch is compact", settings.includes("h-6 w-10"), true);
check("connector switch is compact", connectors.includes("h-6 w-10"), true);
check("no fake camera permission switch", /SettingsToggle label="Camera"/.test(settings), false);
check("no fake microphone permission switch", /SettingsToggle label="Microphone"/.test(settings), false);
check("web search remains wired", settings.includes("web: !preferences.tools.web"), true);
check("artifacts remain wired", settings.includes("artifacts: !preferences.tools.artifacts"), true);
check("code execution remains wired", settings.includes("code: !preferences.tools.code"), true);
check("skill teaching posts to the real store", settings.includes('fetch("/api/memory/skills"'), true);
check("built-in skills are behind a disclosure", settings.includes('title="Built-in skills"'), true);
check("playbooks are behind a disclosure", settings.includes('title="Playbooks"'), true);
check("device conversations use the drawer count", settings.includes("<Count value={localChatCount} />"), true);
check("cloud state is separately named", settings.includes("Synced to your account"), true);
check("facts can still be forgotten", settings.includes("void forget(item.id)"), true);
check("five taps reveal diagnostics", settings.includes("DIAGNOSTICS_TAPS = 5"), true);
check("diagnostics reuses the shared check route", settings.includes('fetch("/api/system/diagnostics"'), true);
check("diagnostics can clear an engine pin", settings.includes("routeOverride: undefined"), true);
check("provider catalog has one disclosure", connectors.includes('title="Available providers"'), true);
check("provider catalog is closed initially", connectors.includes("const [providersOpen, setProvidersOpen] = useState(false)"), true);
check("advanced connectors are closed initially", connectors.includes("const [advancedOpen, setAdvancedOpen] = useState(false)"), true);
check("manual connector kinds still use the shared drop-down", connectors.includes("CONNECTOR_KINDS.map((kind) =>"), true);
check("manual connectors are still tested before save", connectors.includes("/api/connectors/test"), true);
check("home compose no longer displays the brand image", css.includes('button[aria-label="Compose Menu"]:has(img) img'), true);
check("drawer profile affordance is enlarged", css.includes("width: 36px !important"), true);
check("settings cards use compact radius", css.includes("border-radius: 14px"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
