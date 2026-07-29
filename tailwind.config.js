/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "Segoe UI",
          "sans-serif"
        ],
        display: ["var(--font-display)", "ui-serif", "Georgia", "Cambria", "Times New Roman", "serif"]
      },
      colors: {
        app: "var(--bg-app)",
        surface: "var(--bg-surface)",
        card: "var(--bg-card)",
        "elev-1": "var(--bg-elev-1)",
        "elev-2": "var(--bg-elev-2)",
        "elev-3": "var(--bg-elev-3)",
        overlay: "var(--bg-overlay)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
        disabled: "var(--text-disabled)",
        accent: "var(--accent-primary)",
        "accent-pressed": "var(--accent-primary-pressed)",
        info: "var(--accent-info)",
        success: "var(--accent-success)",
        warning: "var(--accent-warning)",
        danger: "var(--accent-danger)"
      },
      maxWidth: {
        app: "var(--navi-content-max-width)"
      },
      spacing: {
        gutter: "var(--navi-page-gutter)",
        section: "var(--navi-section-gap)",
        header: "var(--navi-header-height)",
        composer: "var(--navi-composer-min-height)",
        tap: "var(--navi-tap-target)"
      },
      borderRadius: {
        card: "var(--navi-radius-card)",
        composer: "var(--navi-radius-composer)",
        sheet: "var(--navi-radius-sheet)"
      },
      boxShadow: {
        card: "var(--navi-shadow-card)",
        sheet: "var(--navi-shadow-sheet)",
        menu: "var(--navi-shadow-sheet)",
        dock: "0 -18px 48px rgba(0,0,0,.20)",
        composer: "0 10px 32px var(--shadow-base)"
      }
    }
  },
  plugins: [require("@tailwindcss/typography")]
};
