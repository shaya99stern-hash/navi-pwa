/**
 * Build identity, stamped in by next.config.mjs.
 *
 * An installed PWA swaps its shell silently, so "which version am I running"
 * is otherwise unanswerable from inside the app — and the usual workaround is
 * to delete and reinstall it.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_NAVI_VERSION || "0.0.0";
export const APP_BUILD = process.env.NEXT_PUBLIC_NAVI_BUILD || "";
export const APP_BUILT_AT = process.env.NEXT_PUBLIC_NAVI_BUILT_AT || "";

/**
 * The same build identity under the name the engine modules ask for.
 *
 * `APP_VERSION` is what the shell has always called it; Navi Soul's edge routes
 * and local processor speak of the version of Navi rather than of the app. An
 * alias keeps one source of truth instead of a second environment read that
 * could report a different number than the settings sheet.
 */
export const NAVI_VERSION = APP_VERSION;

/** e.g. `Version 4.2.0 (a1b2c3d) · 2026-07-31` */
export function versionLabel(): string {
  const build = APP_BUILD ? ` (${APP_BUILD})` : "";
  const date = APP_BUILT_AT ? ` · ${APP_BUILT_AT}` : "";
  return `Version ${APP_VERSION}${build}${date}`;
}
