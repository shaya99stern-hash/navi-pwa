export const NAVI_LAYOUT = {
  contentMaxWidth: 480,
  pageGutter: 16,
  sectionGap: 24,
  headerHeight: 52,
  composerMinHeight: 52,
  tapTarget: 44,
  radiusCard: 16,
  radiusComposer: 26,
  radiusSheet: 20
} as const;

/* Keep the TypeScript contract aligned with the CSS variables in globals.css.
   These values are consumed by tests/tooling; they must describe the product
   that actually renders rather than a previous palette. */
export const NAVI_MOTION = {
  pressMs: 150,
  sheetMs: 400,
  drawerMs: 300,
  messageMs: 150,
  easeStandard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  easeSheet: "cubic-bezier(0.25, 1, 0.5, 1)",
  easeExit: "cubic-bezier(0.4, 0, 1, 1)"
} as const;

export const NAVI_COLORS = {
  light: {
    app: "#FAF9F5",
    surface: "#F5F4EE",
    card: "#FFFFFF",
    textPrimary: "#1F1E1D",
    textSecondary: "#52504A",
    textTertiary: "#74716A",
    accent: "#AD5132",
    borderSoft: "rgba(31,30,29,0.09)",
    overlay: "rgba(31,30,29,0.32)"
  },
  dark: {
    app: "#121214",
    surface: "#18181B",
    card: "#27272A",
    textPrimary: "#F5F4EF",
    textSecondary: "#C2C0B7",
    textTertiary: "#9B9A91",
    accent: "#D97757",
    borderSoft: "rgba(255,255,255,0.09)",
    overlay: "rgba(0,0,0,0.50)"
  }
} as const;
