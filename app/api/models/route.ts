import { getProviderStackStatus } from "@/lib/ai/providers";
import type { ModelPreset } from "@/lib/ai/types";
import { MODEL_PRESETS } from "@/lib/chat";

export const runtime = "edge";

const VALID_PRESETS = new Set<ModelPreset>(MODEL_PRESETS.map((preset) => preset.id));

export function GET(): Response {
  const configuredDefault = process.env.NAVI_DEFAULT_MODEL_PRESET as ModelPreset | undefined;
  const stack = getProviderStackStatus();
  return Response.json(
    {
      presets: MODEL_PRESETS,
      providers: stack.providers,
      providerStack: {
        active: stack.active,
        total: stack.total,
        fullStack: stack.fullStack,
        missing: stack.missing
      },
      swarms: {
        "navi-5": { agents: 64, privateDeliberation: true },
        "navi-sol-5-6": { agents: 96, privateDeliberation: true }
      },
      defaultPreset: configuredDefault && VALID_PRESETS.has(configuredDefault) ? configuredDefault : "auto"
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
