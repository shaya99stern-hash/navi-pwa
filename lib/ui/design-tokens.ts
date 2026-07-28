export const NAVI_LAYOUT = {
  contentMaxWidth: 480,
  pageGutter: 16,
  sectionGap: 24,
  headerHeight: 56,
  composerMinHeight: 56,
  tapTarget: 48,
  radiusCard: 20,
  radiusComposer: 24,
  radiusSheet: 28
} as const;

export const NAVI_MOTION = {
  pressMs: 140,
  sheetMs: 260,
  drawerMs: 240,
  messageMs: 140,
  easeStandard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  easeExit: "cubic-bezier(0.4, 0, 1, 1)"
} as const;

export const NAVI_COLORS = {
  light: {
    app: "#C97A63",
    surface: "#F4EEE6",
    card: "#FFFDF9",
    textPrimary: "#1E1814",
    textSecondary: "#665D56",
    borderSoft: "rgba(30,24,20,0.08)",
    overlay: "rgba(17,15,13,0.22)"
  },
  dark: {
    app: "#191614",
    surface: "#24201E",
    card: "#2E2926",
    textPrimary: "#F6F1EA",
    textSecondary: "#C8BEB5",
    borderSoft: "rgba(255,255,255,0.08)",
    overlay: "rgba(0,0,0,0.38)"
  }
} as const;
