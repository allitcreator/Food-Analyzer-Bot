import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
        card: "26px",
      },
      boxShadow: {
        // Мягкая тёплая тень карточек; в тёмной теме --shadow = none.
        soft: "var(--shadow)",
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        // Тёплая палитра (см. index.css): плашки БЖУ, вода, столбики недели.
        "accent-soft": "hsl(var(--accent-soft) / <alpha-value>)",
        fill: "hsl(var(--fill) / <alpha-value>)",
        ok: {
          DEFAULT: "hsl(var(--ok) / <alpha-value>)",
          soft: "hsl(var(--ok-soft) / <alpha-value>)",
        },
        bad: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          soft: "hsl(var(--bad-soft) / <alpha-value>)",
        },
        prot: {
          bg: "hsl(var(--prot-bg) / <alpha-value>)",
          fg: "hsl(var(--prot-fg) / <alpha-value>)",
        },
        fat: {
          bg: "hsl(var(--fat-bg) / <alpha-value>)",
          fg: "hsl(var(--fat-fg) / <alpha-value>)",
        },
        carb: {
          bg: "hsl(var(--carb-bg) / <alpha-value>)",
          fg: "hsl(var(--carb-fg) / <alpha-value>)",
        },
        water: {
          DEFAULT: "hsl(var(--water) / <alpha-value>)",
          soft: "hsl(var(--water-soft) / <alpha-value>)",
        },
        wk: {
          ok: "hsl(var(--wk-ok) / <alpha-value>)",
          near: "hsl(var(--wk-near) / <alpha-value>)",
          over: "hsl(var(--wk-over) / <alpha-value>)",
          today: "hsl(var(--wk-today) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
