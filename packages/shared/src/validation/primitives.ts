/**
 * Reusable, hardened Zod primitives.
 *
 * Security notes
 *  - SQL injection: the real control is parameterisation (supabase-js /
 *    PostgREST never interpolate values into SQL). These schemas are
 *    defense-in-depth that also give users precise error messages.
 *  - XSS: React escapes on render; we additionally reject markup, script
 *    URLs and control characters at the edge, and the database repeats the
 *    same check in CHECK constraints (public.is_plain_text).
 *  - Mass assignment: object schemas are `.strict()` so unknown keys
 *    (e.g. `role`, `is_verified`) are rejected, not silently passed through.
 */
import { z } from 'zod';
import { randToCents } from '../money';

// What an HTML parser treats as a tag / comment / PI start ("x < y" is fine).
const TAG_RE = /<\/?[A-Za-z!?]/;
const SCRIPT_URL_RE = /(javascript|vbscript|data)\s*:/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Bidi overrides can disguise text direction (Trojan Source style spoofing).
const BIDI_RE = /[‪-‮⁦-⁩]/;

/** Mirrors public.is_plain_text() in the database. */
export function isPlainText(value: string): boolean {
  return !TAG_RE.test(value) && !SCRIPT_URL_RE.test(value) && !CONTROL_RE.test(value) && !BIDI_RE.test(value);
}

interface PlainTextOptions {
  min?: number;
  max: number;
  multiline?: boolean;
  label?: string;
}

/** Normalised, length-bounded, markup-free text. */
export function plainText({ min = 1, max, multiline = false, label = 'This field' }: PlainTextOptions) {
  return z
    .string({ error: `${label} is required` })
    .transform((raw) => {
      let v = raw.normalize('NFC').trim();
      v = multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ');
      return v;
    })
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`)
        .refine(isPlainText, `${label} contains characters or markup that aren't allowed`),
    );
}

/** Optional free text: empty string → undefined. */
export function optionalPlainText(opts: Omit<PlainTextOptions, 'min'>) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    plainText({ ...opts, min: 1 }).optional(),
  );
}

export const personName = plainText({ min: 2, max: 120, label: 'Name' }).refine(
  (v) => !/[<>{}[\]\\|^~`$]/.test(v),
  'Name contains invalid characters',
);

export const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

/**
 * South African phone numbers in any common format → E.164 (+27XXXXXXXXX).
 * Accepts: 082 123 4567 · 0821234567 · +27 82 123 4567 · 0027821234567 · 27821234567
 */
export function normalizeSaPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  let national: string | null = null;
  if (/^\+27\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0027\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^27\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  if (!national || national.startsWith('0')) return null;
  return `+27${national}`;
}

export const saPhone = z
  .string()
  .transform((v, ctx) => {
    const normalized = normalizeSaPhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid South African phone number' });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalSaPhone = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  saPhone.optional(),
);

/**
 * Passwords: length over complexity (NIST SP 800-63B), but Supabase is
 * configured with `lower_upper_letters_digits`, so we enforce the same here.
 * Max 72 BYTES because bcrypt silently truncates beyond that.
 */
export const password = z
  .string({ error: 'Password is required' })
  .min(12, 'Use at least 12 characters')
  .refine((v) => new TextEncoder().encode(v).length <= 72, 'Password is too long (max 72 bytes)')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper- and lower-case letters and a number');

export const uuid = z.uuid('Invalid identifier');

export const isoDateTime = z.iso.datetime({ offset: true, error: 'Invalid date/time' });

export const isoDate = z.iso.date('Invalid date');

export const postalCode = z.string().trim().regex(/^\d{4}$/, 'Postal codes are 4 digits');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');

/** Latitude/longitude restricted to South Africa (mirrors public.sa_point). */
export const saLatitude = z.number().min(-35.5).max(-21.5, 'Location must be in South Africa');
export const saLongitude = z.number().min(16).max(33.5, 'Location must be in South Africa');

/** Rand amount typed by a human ("850", "850.5", "1 250,00") → integer cents. */
export const randAmount = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const cents = randToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount like 850 or 850.00' });
      return z.NEVER;
    }
    return cents;
  })
  .pipe(z.number().int().min(0).max(100_000_000, 'Amount is too large'));

export const cents = z.number().int().min(0).max(100_000_000);

export const percent = z.coerce.number().int().min(0).max(100);

export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
