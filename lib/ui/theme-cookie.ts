export const THEME_COOKIE = "navi.theme";

/**
 * The Apple status-bar style is read once at launch and cannot be changed at
 * runtime, so the server has to render it. localStorage is invisible to the
 * server; a cookie is not.
 */
export function persistThemeCookie(theme: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax${secure}`;
}
