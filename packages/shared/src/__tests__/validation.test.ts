import { describe, expect, it } from 'vitest';
import {
  createBookingSchema,
  isPlainText,
  normalizeSaPhone,
  serviceSchema,
  signUpSchema,
  submitQuoteSchema,
  workingHoursSchema,
} from '../validation';
import { applyBps, formatZar, randToCents } from '../money';
import { haversineKm, isWithinTravelRadius } from '../geo';
import { canTransition, trackerSteps } from '../status';
import { maskEmail, maskPhone, redactPII } from '../popia';
import { extractDbErrorCode, httpStatusForDbError } from '../errors';
import { minutesIntoSaDay, saLocalToIso } from '../time';

const future = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const id = '0b8f3c1e-6a2d-4f7b-9c3e-1d2a3b4c5d6e';

describe('XSS / injection hygiene', () => {
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    'hello\u0000world',
    'abc‮def',
    '</title>',
    '<!-- x -->',
  ])('rejects %s', (v) => expect(isPlainText(v)).toBe(false));

  it.each(['Braids & locs', 'R100 > R50 deal', "O'Reilly's salon", "Ndlovu's — 5★", 'x < y'])('allows %s', (v) =>
    expect(isPlainText(v)).toBe(true),
  );

  it('rejects unknown keys (mass assignment)', () => {
    const r = serviceSchema.safeParse({ title: 'Cut', pricingModel: 'instant_book', price: '100', durationMinutes: 30, is_verified: true });
    expect(r.success).toBe(false);
  });
});

describe('South African phone numbers', () => {
  it.each([
    ['082 123 4567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
    ['0027821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['(011) 123-4567', '+27111234567'],
  ])('%s → %s', (input, out) => expect(normalizeSaPhone(input)).toBe(out));

  it.each(['12345', '+44 20 7946 0958', '0021234567', ''])('rejects %s', (v) => expect(normalizeSaPhone(v)).toBeNull());
});

describe('signUpSchema', () => {
  const base = {
    fullName: '  Thandi   Mokoena ',
    email: ' Thandi@Example.CO.ZA ',
    password: 'Correct-Horse-9-Battery',
    confirmPassword: 'Correct-Horse-9-Battery',
    accountType: 'client' as const,
    popiaConsent: true as const,
  };

  it('normalises name and email', () => {
    const r = signUpSchema.parse(base);
    expect(r.fullName).toBe('Thandi Mokoena');
    expect(r.email).toBe('thandi@example.co.za');
    expect(r.marketingOptIn).toBe(false);
  });

  it('requires explicit POPIA consent', () => {
    expect(signUpSchema.safeParse({ ...base, popiaConsent: false }).success).toBe(false);
  });

  it('cannot self-assign admin', () => {
    expect(signUpSchema.safeParse({ ...base, accountType: 'admin' }).success).toBe(false);
  });

  it('enforces bcrypt 72-byte limit and complexity', () => {
    expect(signUpSchema.safeParse({ ...base, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    const long = 'Aa1' + 'é'.repeat(40);
    expect(signUpSchema.safeParse({ ...base, password: long, confirmPassword: long }).success).toBe(false);
  });
});

describe('services & quotes', () => {
  it('instant-book needs a price; converts Rand to cents', () => {
    expect(serviceSchema.safeParse({ title: 'Cut', pricingModel: 'instant_book', durationMinutes: 30 }).success).toBe(false);
    const r = serviceSchema.parse({ title: 'Cut', pricingModel: 'instant_book', price: 'R 1 250,50', durationMinutes: '45' });
    expect(r.price).toBe(125050);
    expect(r.durationMinutes).toBe(45);
  });

  it('quote-required may omit price', () => {
    expect(serviceSchema.safeParse({ title: 'Diagnostics', pricingModel: 'quote_required', durationMinutes: 120 }).success).toBe(true);
  });

  it('quote amount minimum R1', () => {
    expect(submitQuoteSchema.safeParse({ appointmentId: id, amount: '0.50' }).success).toBe(false);
    expect(submitQuoteSchema.parse({ appointmentId: id, amount: '1200' }).amount).toBe(120000);
  });
});

describe('booking', () => {
  it('accepts a valid mobile booking', () => {
    const r = createBookingSchema.safeParse({
      serviceId: id,
      startsAt: future(),
      idempotencyKey: id,
      address: { line1: '12 Vilakazi St', suburb: 'Orlando West', city: 'Soweto', postalCode: '1804', lat: -26.24, lng: 27.91 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects addresses outside South Africa and past times', () => {
    expect(
      createBookingSchema.safeParse({
        serviceId: id, startsAt: future(), idempotencyKey: id,
        address: { line1: '10 Downing St', suburb: 'Westminster', city: 'London', postalCode: '1234', lat: 51.5, lng: -0.12 },
      }).success,
    ).toBe(false);
    expect(createBookingSchema.safeParse({ serviceId: id, startsAt: '2020-01-01T10:00:00Z', idempotencyKey: id }).success).toBe(false);
  });

  it('validates working hours like the database', () => {
    expect(workingHoursSchema.safeParse({ mon: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }).success).toBe(true);
    expect(workingHoursSchema.safeParse({ mon: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '17:00' }] }).success).toBe(false);
    expect(workingHoursSchema.safeParse({ funday: [] }).success).toBe(false);
  });
});

describe('money', () => {
  it.each([
    ['850', 85000], ['850.5', 85050], ['850,50', 85050], ['R1 250.00', 125000], ['1,250.00', 125000], ['0.07', 7],
  ])('randToCents(%s) = %i', (s, c) => expect(randToCents(s)).toBe(c));

  it.each(['abc', '1.234', '-5', '', '1e5'])('randToCents rejects %s', (s) => expect(randToCents(s)).toBeNull());

  it('applies basis points like Postgres round()', () => {
    expect(applyBps(85000, 1000)).toBe(8500);
    expect(applyBps(333, 5000)).toBe(167);
  });

  it('formats ZAR', () => expect(formatZar(85000).replace(/\s/g, ' ')).toMatch(/R\s?850,00/));
});

describe('geo', () => {
  const sandton = { lat: -26.1076, lng: 28.0567 };
  const soweto = { lat: -26.2485, lng: 27.8585 };
  it('haversine is roughly right', () => expect(haversineKm(sandton, soweto)).toBeGreaterThan(24));
  it('travel radius pre-check', () => {
    expect(isWithinTravelRadius(soweto, sandton, 30)).toBe(true);
    expect(isWithinTravelRadius(soweto, sandton, 10)).toBe(false);
  });
});

describe('status machine & tracker', () => {
  it('mirrors database transitions', () => {
    expect(canTransition('requested', 'confirmed')).toBe(true);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('confirmed', 'requested')).toBe(false);
  });
  it('tracker marks en-route for mobile jobs', () => {
    const steps = trackerSteps('confirmed', 'en_route', true);
    expect(steps.find((s) => s.current)?.key).toBe('en_route');
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['requested', 'confirmed', 'en_route']);
  });
});

describe('POPIA helpers', () => {
  it('masks identifiers', () => {
    expect(maskEmail('thandi@example.co.za')).toBe('t***@example.co.za');
    expect(maskPhone('+27821234567')).toBe('+27 82 *** 4567');
  });
  it('deep-redacts PII', () => {
    const r = redactPII({ email: 'a@b.c', nested: { phone: '1', ok: 1 }, list: [{ password: 'x' }] });
    expect(r).toEqual({ email: '[REDACTED]', nested: { phone: '[REDACTED]', ok: 1 }, list: [{ password: '[REDACTED]' }] });
  });
});

describe('errors & time', () => {
  it('extracts db codes and statuses', () => {
    expect(extractDbErrorCode('SLOT_UNAVAILABLE')).toBe('SLOT_UNAVAILABLE');
    expect(extractDbErrorCode('INVALID_STATUS_TRANSITION: a -> b')).toBe('INVALID_STATUS_TRANSITION');
    expect(extractDbErrorCode('duplicate key value')).toBe('INTERNAL_ERROR');
    expect(httpStatusForDbError('PT409')).toBe(409);
    expect(httpStatusForDbError('42501')).toBe(403);
  });
  it('places SA local times on the calendar grid', () => {
    const iso = saLocalToIso('2026-11-18', '09:30');
    expect(iso).toBe('2026-11-18T07:30:00.000Z');
    expect(minutesIntoSaDay(iso)).toBe(570);
  });
});
