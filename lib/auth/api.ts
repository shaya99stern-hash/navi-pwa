import "server-only";

import { isClerkConfigured, isClerkUserAllowed } from "./config";
import { getRequestClerkUserId } from "./session";
import { isSameOrigin } from "@/lib/security/request";

export async function authorizeApiMutation(request: Request): Promise<Response | null> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (!isClerkConfigured()) {
    if (process.env.NODE_ENV !== "production") return null;
    return Response.json(
      { error: "Secure sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const userId = await getRequestClerkUserId(request);
  if (!userId) {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (!isClerkUserAllowed(userId)) {
    return Response.json({ error: "This account does not have access to NaviOS." }, { status: 403 });
  }
  return null;
}
