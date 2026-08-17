import { NextResponse } from "next/server";

import { authorizeApiMutation } from "@/lib/auth/api";
import { refusalWorthSurfacing, synthesizeSpeech } from "@/lib/ai/voice/tts";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One spoken utterance, streamed.
 *
 * The counterpart to `../transcribe`: that route turns a segment of speech into
 * text, this one turns a sentence of text into speech. Both exist so the client
 * never holds a vendor credential, and both are per-utterance rather than
 * per-turn so audio can start while the rest is still being produced.
 *
 * The response is deliberately one of two completely different shapes, and the
 * client is expected to handle both without treating either as an error:
 *
 *  - **Audio**, streamed from the first chunk, when premium speech was
 *    available and affordable.
 *  - **204 No Content**, when it was not. Not a failure — the instruction to
 *    speak with the browser's own voice instead. An unconfigured deployment
 *    takes this path on every request and is working correctly.
 *
 * A refusal is never a 4xx or 5xx, because a status code that reads as broken
 * would put an error in front of someone whose voice mode is about to work
 * perfectly well with the on-device voice. The reason travels in a header for
 * diagnostics, and only a spent budget is worth showing a person — the rest are
 * a change of timbre, not a fault.
 */
export async function POST(request: Request) {
  const refusal = await authorizeApiMutation(request);
  if (refusal) return refusal;

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text : "";
  } catch {
    return NextResponse.json({ error: "Send JSON with a text field." }, { status: 400 });
  }

  const spoken = await synthesizeSpeech({ text, signal: request.signal });

  if (!spoken.ok) {
    /* 204 rather than an error: the client falls back to the on-device voice,
       which is the correct behaviour rather than a degraded one. */
    console.info(`Navi Soul premium speech declined (${spoken.reason}): ${spoken.detail}`);
    return new Response(null, {
      status: 204,
      headers: {
        "X-Navi-Speech": spoken.reason,
        /* Lets the client decide whether to say anything, without it needing to
           know which reasons are worth a person's attention. */
        "X-Navi-Speech-Surface": refusalWorthSurfacing(spoken.reason) ? "1" : "0",
        "Cache-Control": "no-store"
      }
    });
  }

  return new Response(spoken.audio, {
    status: 200,
    headers: {
      "Content-Type": spoken.contentType,
      "X-Navi-Speech": "ok",
      /* What this utterance cost, so the client can show a running total
         without a second request to read the ledger. */
      "X-Navi-Speech-Chars": String(spoken.charged),
      "Cache-Control": "no-store"
    }
  });
}
