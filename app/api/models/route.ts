import { getProviderAvailability } from "@/lib/ai/providers";
import { MODEL_PRESETS } from "@/lib/chat";

export const runtime = "edge";

export function GET(): Response {
  return Response.json(
    {
      presets: MODEL_PRESETS,
      providers: getProviderAvailability(),
      defaultPreset: process.env.NAVI_DEFAULT_MODEL_PRESET ?? "auto"
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
