import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#EFEFF2",
        surface: "#FFFFFF",
        line: "#EAECF0",
        heading: "#101828",
        body: "#344054",
        muted: "#667085",
        faint: "#98A2B3",
        indigo: {
          50: "#F4F3FF", 100: "#EBE9FE", 200: "#D9D6FE",
          400: "#9B8AFB", 500: "#7A5AF8", 600: "#6438E8", 700: "#5925DC",
        },
        success: { 50: "#ECFDF3", 500: "#12B76A", 700: "#027A48" },
        warning: { 50: "#FFFAEB", 500: "#F79009", 700: "#B54708" },
        info: { 50: "#EFF8FF", 500: "#2E90FA", 700: "#175CD3" },
        danger: { 50: "#FEF3F2", 500: "#F04438", 700: "#B42318" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "18px" },
      boxShadow: {
        card: "0 1px 2px 0 rgba(16,24,40,0.05)",
        pop: "0 12px 32px -8px rgba(16,24,40,0.14)",
      },
      fontSize: {
        micro: ["11px", { lineHeight: "16px" }],
        tiny: ["12px", { lineHeight: "18px" }],
      },
    },
  },
  plugins: [],
};
export default config;
