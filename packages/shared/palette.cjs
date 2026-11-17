/**
 * Khula palette — a warm, South African colour system.
 *
 *   brand  Bushveld green   primary actions, links, "Khula" (isiZulu: grow)
 *   sun    Highveld gold    highlights, ratings, the accent word in headlines
 *   clay   Karoo terracotta secondary accent, warm illustrations
 *   sand   warm neutrals    surfaces, borders, body & secondary text
 *   ink    near-black       headings
 *   bead   beadwork stripe  the signature multi-colour band (see BeadStripe)
 *
 * Plain CommonJS data so it can be read by the Tailwind preset (Node) and
 * imported by React Native code that needs raw colour values (icons, tints).
 */
const brand = {
  50: '#edf8f3',
  100: '#d2eee1',
  200: '#a7dbc4',
  300: '#71c0a0',
  400: '#3fa17c',
  500: '#1f8462',
  600: '#146b4f',
  700: '#115641',
  800: '#0f4535',
  900: '#0c392c',
  950: '#062019',
};

const sun = {
  50: '#fff9eb',
  100: '#feefc7',
  200: '#fddf8a',
  300: '#fccb4d',
  400: '#f9b724',
  500: '#f09a0b',
  600: '#d47506',
  700: '#b0540a',
  800: '#8f410f',
  900: '#763610',
};

const clay = {
  50: '#fcf3ef',
  100: '#f8e3d9',
  200: '#f0c4b0',
  300: '#e59d80',
  400: '#d9744f',
  500: '#c95a34',
  600: '#ad4628',
  700: '#8e3823',
  800: '#743022',
  900: '#602a1f',
};

// Warm neutrals. 500 and darker meet WCAG AA (4.5:1) as text on white.
const sand = {
  50: '#faf8f5',
  100: '#f4f0ea',
  200: '#e8e1d6',
  300: '#d6ccbc',
  400: '#a89c88',
  500: '#7a6f5e',
  600: '#5f564a',
  700: '#4a433a',
  800: '#332e28',
  900: '#221f1a',
  950: '#15130f',
};

const ink = { DEFAULT: '#1d1a16', muted: sand[600], subtle: sand[400] };

// Beadwork stripe, read left to right. Echoes the flag without copying it.
const bead = {
  green: brand[600],
  gold: sun[400],
  red: clay[500],
  blue: '#1f3f99',
  black: ink.DEFAULT,
};

module.exports = { brand, sun, clay, sand, ink, bead };
