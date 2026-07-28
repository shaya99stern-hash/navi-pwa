import "server-only";

import { auth } from "@clerk/nextjs/server";
import { isClerkConfigured, isClerkUserAllowed } from "./config";
import { isSameOrigin } from "@/lib/security/request";

export async function authorizeApiMutation(request: Request): Promise<Response | null> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (!isClerkConfigured()) return null;

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (!isClerkUserAllowed(userId)) {
    return Response.json({ error: "This account does not have access to Navi." }, { status: 403 });
  }
  return null;
}
