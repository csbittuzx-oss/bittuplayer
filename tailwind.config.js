/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'spotify-green': '#1DB954',
        'spotify-green-hover': '#1ed760',
        'spotify-dark-base': '#121212',
        'spotify-dark-elevated': '#1a1a1a',
        'spotify-dark-highlight': '#282828',
        'spotify-dark-press': '#333333',
        'spotify-text-primary': '#FFFFFF',
        'spotify-text-secondary': '#B3B3B3',
        'spotify-text-subdued': '#6a6a6a',
      }
    },
  },
  plugins: [],
}
