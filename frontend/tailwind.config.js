/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        system: {
          blue: '#034EA2',
        }
      },
      fontFamily: {
        sans: ['Geist Variable', 'SF Pro Display', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
