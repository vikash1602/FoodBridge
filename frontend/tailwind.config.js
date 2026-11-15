/** Design system: "The Kitchen Ledger" — warm paper, forest green, saffron. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#FAF6EC",
          warm: "#F3EBD8",
          deep: "#EAE0C8",
        },
        forest: {
          50: "#F0F7F1",
          100: "#DCEEE0",
          200: "#BADCC4",
          300: "#8DC3A0",
          400: "#5DA67D",
          500: "#3B8A60",
          600: "#2A6E4C",
          700: "#23583F",
          800: "#1E4533",
          900: "#1A3A2C",
          950: "#0D221A",
        },
        saffron: {
          50: "#FDF8EB",
          100: "#F9EDCB",
          200: "#F2D794",
          300: "#EABD5C",
          400: "#E3A733",
          500: "#D98E14",
          600: "#BC6F0C",
          700: "#97500D",
          800: "#7C3F12",
          900: "#673413",
        },
        tomato: {
          400: "#F06449",
          500: "#E14B2E",
          600: "#C93A1F",
        },
        pantry: {
          950: "#151009",
          900: "#1E1812",
          800: "#2A231B",
          700: "#3B3227",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,25,23,.06), 0 4px 16px -4px rgba(28,25,23,.10)",
        lift: "0 2px 4px rgba(28,25,23,.08), 0 12px 32px -8px rgba(28,25,23,.18)",
        glow: "0 0 0 3px rgba(217,142,20,.35)",
        "glow-green": "0 0 0 3px rgba(42,110,76,.30)",
      },
      borderRadius: {
        ticket: "14px 14px 14px 4px",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.6)", opacity: "0.8" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        wiggle: {
          "0%,100%": { transform: "rotate(-1.5deg)" },
          "50%": { transform: "rotate(1.5deg)" },
        },
      },
      animation: {
        marquee: "marquee 30s linear infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.2,0.6,0.4,1) infinite",
        wiggle: "wiggle 0.4s ease-in-out",
      },
    },
  },
  plugins: [],
};
