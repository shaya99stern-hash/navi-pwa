import { getProviderStackStatus } from "@/lib/ai/providers";
import { devToolAvailability } from "@/lib/ai/dev-tools";
import { searchProviderName } from "@/lib/ai/web-tools";
import { getSwarmCatalogStatus } from "@/lib/ai/swarm-router";
import type { ModelPreset } from "@/lib/ai/types";
import { MODEL_PRESETS } from "@/lib/chat";

export const runtime = "edge";

const VALID_PRESETS = new Set<ModelPreset>(MODEL_PRESETS.map((preset) => preset.id));

function normalizeConfiguredDefault(value: string | undefined): ModelPreset {
  if (value === "navi-5" || value === "fable-5") return "navi-fable";
  if (value === "navi-sol-5-6" || value === "opus-4-8") return "navi-sol";
  return value && VALID_PRESETS.has(value as ModelPreset) ? value as ModelPreset : "auto";
}

export async function GET(request: Request): Promise<Response> {
  const stack = getProviderStackStatus();
  const catalog = await getSwarmCatalogStatus(request.signal).catch(() => ({
    dynamicCatalog: false,
    routerModels: 0,
    fableCatalogCandidates: 0,
    solCatalogCandidates: 0
  }));

  return Response.json(
    {
      presets: MODEL_PRESETS,
      providers: stack.providers,
      // Which developer connections have a token, for the Connectors page.
      devTools: devToolAvailability(),
      /* Research mode can be switched on with no search provider behind it,
         which looks identical to working until an answer quietly comes from
         memory. The Integrations sheet reports the difference. */
      search: { configured: Boolean(searchProviderName()), provider: searchProviderName() },
      providerStack: {
        active: stack.active,
        total: stack.total,
        fullStack: stack.fullStack,
        missing: stack.missing
      },
      swarms: {
        "navi-fable": {
          specialistRoles: 72,
          profile: "long-horizon projects, coding, tests, documents, and visual verification",
          adaptiveModelSelection: true,
          maxConcurrentCouncils: 8,
          privateDeliberation: true,
          candidateModels: catalog.fableCatalogCandidates
        },
        "navi-sol": {
          specialistRoles: 96,
          profile: "parallel reasoning, research, quantitative work, design, and blind verification",
          adaptiveModelSelection: true,
          maxConcurrentCouncils: 10,
          privateDeliberation: true,
          candidateModels: catalog.solCatalogCandidates
        }
      },
      huggingFaceCatalog: {
        dynamicDiscovery: catalog.dynamicCatalog,
        routerModels: catalog.routerModels,
        note: "The catalog may contain hundreds of live models; each request activates only a task-matched subset."
      },
      defaultPreset: normalizeConfiguredDefault(process.env.NAVI_DEFAULT_MODEL_PRESET)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
