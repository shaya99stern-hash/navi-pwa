/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Inter",
          "system-ui",
          "sans-serif"
        ]
      },
      colors: {
        navi: {
          background: "#0d0d0d",
          elevated: "#171717",
          surface: "#212121",
          border: "#303030",
          muted: "#a3a3a3"
        }
      },
      boxShadow: {
        menu: "0 24px 70px rgba(0, 0, 0, 0.62)",
        composer: "0 -16px 45px rgba(13, 13, 13, 0.82)"
      }
    }
  },
  plugins: [require("@tailwindcss/typography")]
};
