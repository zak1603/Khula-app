import { z } from 'zod';
import { APPOINTMENT_STATUSES, JOB_PROGRESS } from '../types';
import {
  isoDate,
  isoDateTime,
  optionalPlainText,
  optionalSaPhone,
  personName,
  plainText,
  postalCode,
  randAmount,
  saLatitude,
  saLongitude,
  uuid,
} from './primitives';

export const bookingAddressSchema = z
  .object({
    line1: plainText({ min: 2, max: 200, label: 'Street address' }),
    line2: optionalPlainText({ max: 200, label: 'Unit / complex' }),
    suburb: plainText({ min: 2, max: 80, label: 'Suburb' }),
    city: plainText({ min: 2, max: 80, label: 'City' }),
    postalCode,
    lat: saLatitude,
    lng: saLongitude,
  })
  .strict();

const MAX_ADVANCE_MS = 90 * 24 * 60 * 60 * 1000;

export const createBookingSchema = z
  .object({
    serviceId: uuid,
    staffId: uuid.nullish(),
    startsAt: isoDateTime,
    address: bookingAddressSchema.optional(),
    message: optionalPlainText({ max: 1000, multiline: true, label: 'Message' }),
    /** Client-generated (crypto.randomUUID) so retries never double-book. */
    idempotencyKey: uuid,
  })
  .strict()
  .superRefine((b, ctx) => {
    const t = Date.parse(b.startsAt);
    // Coarse client-side check; the database enforces the authoritative 30-min lead time.
    if (t < Date.now()) ctx.addIssue({ code: 'custom', message: 'Pick a time in the future', path: ['startsAt'] });
    if (t > Date.now() + MAX_ADVANCE_MS) {
      ctx.addIssue({ code: 'custom', message: 'Bookings open up to 90 days ahead', path: ['startsAt'] });
    }
  });

export const walkInSchema = z
  .object({
    businessId: uuid,
    serviceId: uuid,
    staffId: uuid,
    startsAt: isoDateTime,
    walkInName: personName,
    walkInPhone: optionalSaPhone,
    price: z.preprocess((v) => (v === '' ? undefined : v), randAmount.optional()),
  })
  .strict();

export const statusUpdateSchema = z
  .object({
    appointmentId: uuid,
    status: z.enum(APPOINTMENT_STATUSES).extract(['confirmed', 'completed', 'cancelled']),
    reason: optionalPlainText({ max: 500, label: 'Reason' }),
  })
  .strict()
  .refine((s) => s.status !== 'cancelled' || !!s.reason, {
    message: 'Please give a reason so the client knows what happened',
    path: ['reason'],
  });

export const progressUpdateSchema = z
  .object({
    appointmentId: uuid,
    progress: z.enum(JOB_PROGRESS).exclude(['not_started', 'finished']),
  })
  .strict();

export const rescheduleSchema = z
  .object({ appointmentId: uuid, startsAt: isoDateTime, staffId: uuid.optional() })
  .strict();

export const availabilityQuerySchema = z
  .object({ serviceId: uuid, date: isoDate, staffId: uuid.optional() })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
    serviceModel: z.enum(['fixed_location', 'mobile_onsite']).optional(),
    lat: saLatitude.optional(),
    lng: saLongitude.optional(),
    radiusKm: z.coerce.number().min(1).max(200).default(25),
    page: z.coerce.number().int().min(0).max(50).default(0),
  })
  .strict()
  .refine((s) => (s.lat === undefined) === (s.lng === undefined), { message: 'lat and lng go together', path: ['lat'] });

export type CreateBookingInput = z.input<typeof createBookingSchema>;
export type CreateBookingData = z.output<typeof createBookingSchema>;
export type BookingAddressInput = z.input<typeof bookingAddressSchema>;
export type WalkInInput = z.input<typeof walkInSchema>;
export type WalkInData = z.output<typeof walkInSchema>;
export type StatusUpdateInput = z.input<typeof statusUpdateSchema>;
