import "server-only";

import { describeClerkConfigGap, isClerkConfigured, isClerkUserAllowed } from "./config";
import { getRequestClerkUserId } from "./session";
import { isSameOrigin } from "@/lib/security/request";

export async function authorizeApiMutation(request: Request): Promise<Response | null> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (!isClerkConfigured()) {
    if (process.env.NODE_ENV !== "production") return null;
    /* Not an outage. A credential is absent from this deployment's environment
       and will stay absent until it is redeployed with one, so calling it
       "temporarily unavailable" sends people to a retry button that can never
       succeed — and reads as the app being flaky rather than unconfigured. The
       commonest cause is scoping: Clerk variables set on Production only, with
       a preview deployment then serving an app that has no sign-in at all. */
    console.error(`Navi API refused a request. ${describeClerkConfigGap()}`);
    return Response.json(
      { error: "Sign-in is not configured on this deployment." },
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
