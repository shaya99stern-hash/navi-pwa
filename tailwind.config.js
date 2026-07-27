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
        ]
      },
      colors: {
        app: "var(--bg-app)",
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
      boxShadow: {
        menu: "0 18px 50px rgba(0,0,0,.24)",
        dock: "0 -18px 48px rgba(0,0,0,.20)",
        composer: "0 10px 32px var(--shadow-base)"
      }
    }
  },
  plugins: [require("@tailwindcss/typography")]
};
