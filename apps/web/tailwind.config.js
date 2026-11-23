/** @type {import('tailwindcss').Config} */

// Monochrome design system (see DESIGN.md). Every colour resolves to a CSS variable of RGB channels,
// so opacity modifiers work and light mode is an exact inversion. Legacy hue names used across the
// app are remapped onto the grey scale, which keeps existing markup working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const grey = {
  50: v("fg"),
  100: v("fg"),
  200: v("fg"),
  300: v("soft"),
  400: v("dim"),
  500: v("muted"),
  600: v("mid"),
  700: v("line"),
  800: v("s3"),
  900: v("s2"),
  950: v("s1"),
};

const highlight = {
  50: v("max"),
  100: v("max"),
  200: v("max"),
  300: v("max"),
  400: v("max"),
  500: v("max"),
  600: v("fg"),
  700: v("soft"),
  800: v("s3"),
  900: v("s2"),
  950: v("s1"),
};

const secondary = {
  50: v("soft"),
  100: v("soft"),
  200: v("soft"),
  300: v("soft"),
  400: v("mid"),
  500: v("mid"),
  600: v("mid"),
  700: v("line"),
  800: v("s3"),
  900: v("s2"),
  950: v("s1"),
};

module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: v("max"),
        black: v("bg"),
        bg: v("bg"),
        surface: { 1: v("s1"), 2: v("s2"), 3: v("s3") },
        line: v("line"),
        fg: v("fg"),
        max: v("max"),
        slate: grey,
        gray: grey,
        neutral: grey,
        emerald: highlight,
        rose: highlight,
        amber: highlight,
        sky: secondary,
        violet: secondary,
        ink: v("bg"),
        panel: v("s1"),
        muted: v("muted"),
        accent: v("max"),
        warn: v("max"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "20px",
        "2xl": "20px",
        "3xl": "24px",
        xl: "14px",
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.03em",
      },
      maxWidth: {
        phone: "430px",
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-dot": { "0%, 80%, 100%": { opacity: "0.2" }, "40%": { opacity: "1" } },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
