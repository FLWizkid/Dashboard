import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx,mdx}",
    "./src/components/**/*.{ts,tsx,mdx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // Placeholder brand palette — refine when the visual design lands.
        surface: "#0b0e14",
        panel: "#141a24",
      },
    },
  },
  plugins: [],
};

export default config;
