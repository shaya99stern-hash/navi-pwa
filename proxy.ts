import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getNaviAuthCanonicalOrigin,
  isClerkConfigured,
  isClerkUserAllowed
} from "@/lib/auth/config";
import { getRequestClerkUserId } from "@/lib/auth/session";

function isPublicRoute(pathname: string) {
  return pathname === "/sign-in"
    || pathname.startsWith("/sign-in/")
    || pathname === "/sign-up"
    || pathname.startsWith("/sign-up/")
    || pathname === "/access-denied"
    || pathname === "/api/vitals";
}

/** Defense in depth. Route handlers must authorize sensitive operations themselves. */
export async function proxy(request: NextRequest) {
  if (!isClerkConfigured()) return NextResponse.next();

  const canonicalOrigin = getNaviAuthCanonicalOrigin();
  if (canonicalOrigin && request.nextUrl.origin !== canonicalOrigin) {
    const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin);
    const response = NextResponse.redirect(destination, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (isPublicRoute(request.nextUrl.pathname)) return NextResponse.next();

  const userId = await getRequestClerkUserId(request);
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (!userId) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const response = NextResponse.redirect(new URL("/sign-in", request.url));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (isClerkUserAllowed(userId)) return NextResponse.next();

  if (isApiRoute) {
    return NextResponse.json(
      { error: "This account does not have access to Navi." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  const response = NextResponse.redirect(new URL("/access-denied", request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|txt|webmanifest)).*)", "/(api|trpc)(.*)"]
};
