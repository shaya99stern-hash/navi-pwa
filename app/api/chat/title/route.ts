import { getProviderAvailability } from "@/lib/ai/providers";
import { summariseTitle } from "@/lib/ai/title";

/**
 * A summarised title for a saved conversation.
 *
 * Its own route, called by the client after the first reply has finished,
 * rather than folded into the chat request. The chat route's whole budget is
 * time to first token, and a title is worth nothing to someone still waiting
 * for their answer — running it there would put a model call between the user
 * and the reply to save a round trip nobody is watching.
 *
 * Answering with the heuristic title is always acceptable, so every failure
 * here returns 200 with `title: null` rather than an error status. The client
 * has a perfectly good title already; this either improves it or does not.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Enough for a question and a reply. Longer inputs are clipped downstream. */
const MAX_INPUT_CHARS = 8_000;

export async function POST(request: Request): Promise<Response> {
  let body: { question?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ title: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const question = typeof body.question === "string" ? body.question.slice(0, MAX_INPUT_CHARS) : "";
  const answer = typeof body.answer === "string" ? body.answer.slice(0, MAX_INPUT_CHARS) : "";
  if (!question.trim()) return Response.json({ title: null }, { headers: { "Cache-Control": "no-store" } });

  const title = await summariseTitle({
    question,
    answer,
    availability: getProviderAvailability(),
    origin: new URL(request.url).origin,
    abortSignal: request.signal
  }).catch(() => null);

  return Response.json({ title }, { headers: { "Cache-Control": "no-store" } });
}
