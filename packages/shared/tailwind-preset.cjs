/**
 * Khula design tokens — shared by the Next.js dashboard (Tailwind) and the
 * Expo app (NativeWind) so both products look like one brand.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf4',
          100: '#d8f3e3',
          200: '#b3e6cb',
          300: '#80d2ab',
          400: '#4bb786',
          500: '#289c6b',
          600: '#1a7e56',
          700: '#156548',
          800: '#13503a',
          900: '#114232',
          950: '#08251c',
        },
        sun: { 400: '#f8c64a', 500: '#f2a91c', 600: '#d6850f' },
        ink: { DEFAULT: '#0f172a', muted: '#475569', subtle: '#94a3b8' },
        status: {
          requested: '#f59e0b',
          quoted: '#8b5cf6',
          confirmed: '#10b981',
          completed: '#0ea5e9',
          cancelled: '#94a3b8',
        },
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
