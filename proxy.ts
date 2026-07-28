import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isClerkConfigured, isClerkUserAllowed } from "@/lib/auth/config";

function isPublicRoute(pathname: string) {
  return pathname === "/sign-in"
    || pathname.startsWith("/sign-in/")
    || pathname === "/sign-up"
    || pathname.startsWith("/sign-up/")
    || pathname === "/access-denied";
}

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request.nextUrl.pathname)) return NextResponse.next();
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", request.url));
  if (isClerkUserAllowed(userId)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "This account does not have access to Navi." }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/access-denied", request.url));
});

/** Defense in depth. Route handlers must authorize sensitive operations themselves. */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isClerkConfigured()) return NextResponse.next();
  return (await clerkProxy(request, event)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|txt|webmanifest)).*)", "/(api|trpc)(.*)"]
};
