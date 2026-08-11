import { getProviderStackStatus } from "@/lib/ai/providers";
import { rejectedProviders } from "@/lib/ai/provider-health";
import { devToolAvailability } from "@/lib/ai/dev-tools";
import { searchProviderName } from "@/lib/ai/web-tools";
import { getSwarmCatalogStatus } from "@/lib/ai/swarm-router";
import type { ModelPreset } from "@/lib/ai/types";
import { DIAGNOSTIC_ROUTES, NAVI_MODES } from "@/lib/chat";

export const runtime = "edge";

const VALID_PRESETS = new Set<ModelPreset>(DIAGNOSTIC_ROUTES.map((route) => route.id));

/* This reads a deployment environment variable, not a stored user preference,
   so there is no device to migrate — an unrecognised value falls through to
   `auto`, which is the right answer for a name this build no longer has. The
   aliases that named other companies' models are gone with the rest. */
function normalizeConfiguredDefault(value: string | undefined): ModelPreset {
  return value && VALID_PRESETS.has(value as ModelPreset) ? value as ModelPreset : "auto";
}

/**
 * Presence is not health, and this route was reporting it as though it were.
 *
 * `getProviderStackStatus` answers "is a key set", which is what the composer
 * and the setup notice both read to decide whether anything can answer. A
 * Cerebras key that had been returning `Forbidden` on every request for weeks
 * satisfied that check perfectly, so the app showed ready while every request
 * failed.
 *
 * What real traffic has already learned is the cheapest correction available:
 * the chat route records a credential rejection whenever a provider refuses
 * one, so downgrading those here costs no request and no latency.
 *
 * The limit, stated because a check whose weaknesses are undocumented is how
 * this happened the first time: that record lives in the memory of one edge
 * instance, so a rejection learned while answering may not have reached the
 * instance serving this route. It therefore under-reports and never
 * over-reports — a provider marked unusable here has genuinely refused, while
 * one marked usable may simply not have been tried yet. `diagnose_self` is the
 * authority when the answer has to be certain; it asks every provider directly.
 */
function observedProviders(configured: Record<string, boolean>): Record<string, boolean> {
  const rejected = new Set<string>(rejectedProviders());
  const observed: Record<string, boolean> = {};
  for (const [provider, present] of Object.entries(configured)) observed[provider] = present && !rejected.has(provider);
  return observed;
}

export async function GET(request: Request): Promise<Response> {
  const stack = getProviderStackStatus();
  const usable = observedProviders(stack.providers);
  const rejected = rejectedProviders().filter((provider) => stack.providers[provider]);
  const catalog = await getSwarmCatalogStatus(request.signal).catch(() => ({
    dynamicCatalog: false,
    routerModels: 0,
    deepCatalogCandidates: 0,
    directCatalogCandidates: 0
  }));

  return Response.json(
    {
      // Modes are the product surface; routes are diagnostics only.
      modes: NAVI_MODES,
      /* What can answer, not what has a key. `configured` keeps the raw
         presence answer for the Connectors screen, which needs to show a key
         as set even when it is being refused — "you have not added one" and
         "the one you added is dead" are different screens. */
      providers: usable,
      configured: stack.providers,
      /* Named rather than merely subtracted: a key that is present and refused
         is the one state a person has to act on, and it is invisible if the
         only evidence is a provider quietly missing from a list. */
      rejectedCredentials: rejected,
      // Which developer connections have a token, for the Connectors page.
      devTools: devToolAvailability(),
      /* Research mode can be switched on with no search provider behind it,
         which looks identical to working until an answer quietly comes from
         memory. The Integrations sheet reports the difference. */
      search: { configured: Boolean(searchProviderName()), provider: searchProviderName() },
      providerStack: {
        active: Object.values(usable).filter(Boolean).length,
        total: stack.total,
        fullStack: stack.fullStack,
        missing: stack.missing
      },
      swarms: {
        "navi-soul-deep": {
          specialistRoles: 72,
          profile: "long-horizon projects, coding, tests, documents, and visual verification",
          adaptiveModelSelection: true,
          maxConcurrentCouncils: 8,
          privateDeliberation: true,
          candidateModels: catalog.deepCatalogCandidates
        },
        "navi-soul-direct": {
          specialistRoles: 96,
          profile: "parallel reasoning, research, quantitative work, design, and blind verification",
          adaptiveModelSelection: true,
          maxConcurrentCouncils: 10,
          privateDeliberation: true,
          candidateModels: catalog.directCatalogCandidates
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
