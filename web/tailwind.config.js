/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,   // MUI's CssBaseline already resets styles
  },
  theme: { extend: {} },
  plugins: [],
};
