/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), require('@khula/shared/tailwind-preset')],
  theme: { extend: {} },
  plugins: [],
};
