import { cookies } from "next/headers";

import { THEME_COOKIE } from "./theme-cookie";

/**
 * The theme, read on the server.
 *
 * Server-only: it imports `next/headers`, which is why it is a module of its
 * own rather than another export of `theme-cookie.ts` — that file is imported
 * by client components, and pulling `next/headers` into their graph would
 * break the build.
 *
 * The full-bleed pages outside the app shell need this for the same reason the
 * root layout does: iOS reads `apple-mobile-web-app-status-bar-style` once at
 * launch, so the background a page paints has to be decided on the server,
 * against the same cookie, or the status-bar glyphs end up drawn in the colour
 * of the theme the user is not using.
 */
export async function readAuthTheme(): Promise<"dark" | "light"> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === "light" ? "light" : "dark";
}
