/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        panel: "#121A2B",
        muted: "#8B98B3",
        accent: "#3DDC97",
        warn: "#F5C451",
      },
      maxWidth: {
        phone: "430px",
      },
    },
  },
  plugins: [],
};
