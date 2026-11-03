import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18181b",
        surface: "#f6f7f9"
      }
    }
  },
  plugins: []
} satisfies Config;
