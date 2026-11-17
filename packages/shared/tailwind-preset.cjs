/**
 * Khula design tokens — shared by the Next.js dashboard (Tailwind) and the
 * Expo app (NativeWind) so both products look like one brand.
 * Colour values live in ./palette.cjs.
 * @type {import('tailwindcss').Config}
 */
const { brand, sun, clay, sand, ink, bead } = require('./palette.cjs');

module.exports = {
  theme: {
    extend: {
      colors: {
        brand,
        sun,
        clay,
        sand,
        ink,
        bead,
        status: {
          requested: sun[500],
          quoted: '#8b5cf6',
          confirmed: brand[500],
          completed: '#0ea5e9',
          cancelled: sand[400],
        },
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      letterSpacing: { tightest: '-0.03em' },
    },
  },
};
