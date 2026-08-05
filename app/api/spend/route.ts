import { NextResponse } from "next/server";

import { getProviderAvailability } from "@/lib/ai/providers";
import { formatSpend, getSpendStore, meteredLaneEnabled, readSpend } from "@/lib/ai/spend";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * What Settings → Account needs to show the monthly spend.
 *
 * Deliberately not part of any chat response. The number belongs in the one
 * place a person goes to look at their account, and nowhere near an answer they
 * asked for — a reply interrupted by billing information is a worse reply.
 */
export async function GET() {
  const configured = getProviderAvailability().deepseek;
  if (!configured) return NextResponse.json({ configured: false, enabled: false, summary: null });

  const store = getSpendStore();
  const enabled = meteredLaneEnabled(store);
  const snapshot = await readSpend();

  return NextResponse.json({
    configured: true,
    enabled,
    durable: snapshot.durable,
    state: snapshot.state,
    summary: formatSpend(snapshot)
  });
}
