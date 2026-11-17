import { z } from 'zod';
import { SA_PROVINCES, SERVICE_MODELS, TIP_METHODS, WEEKDAYS } from '../types';
import {
  email,
  optionalPlainText,
  optionalSaPhone,
  plainText,
  postalCode,
  randAmount,
  saLatitude,
  saLongitude,
  slug,
  timeOfDay,
  uuid,
} from './primitives';

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const timeIntervalSchema = z
  .object({ start: timeOfDay, end: timeOfDay })
  .strict()
  .refine((i) => minutes(i.end) > minutes(i.start), { message: 'End must be after start', path: ['end'] });

/** Mirrors public.is_valid_working_hours(). */
export const workingHoursSchema = z
  .partialRecord(z.enum(WEEKDAYS), z.array(timeIntervalSchema).max(4))
  .superRefine((hours, ctx) => {
    for (const [day, intervals] of Object.entries(hours)) {
      const sorted = intervals ?? [];
      for (let i = 1; i < sorted.length; i++) {
        if (minutes(sorted[i]!.start) < minutes(sorted[i - 1]!.end)) {
          ctx.addIssue({ code: 'custom', message: 'Intervals must be in order and not overlap', path: [day, i] });
        }
      }
    }
  });

export const businessSchema = z
  .object({
    name: plainText({ min: 2, max: 120, label: 'Business name' }),
    slug,
    description: optionalPlainText({ max: 2000, multiline: true, label: 'Description' }),
    categoryId: z.coerce.number().int().positive(),
    serviceModel: z.enum(SERVICE_MODELS),
    addressLine1: optionalPlainText({ max: 200, label: 'Address' }),
    addressLine2: optionalPlainText({ max: 200, label: 'Address line 2' }),
    suburb: plainText({ min: 2, max: 80, label: 'Suburb' }),
    city: plainText({ min: 2, max: 80, label: 'City' }),
    province: z.enum(SA_PROVINCES),
    postalCode,
    lat: saLatitude,
    lng: saLongitude,
    travelRadiusKm: z.coerce.number().positive().max(250).optional(),
    phone: optionalSaPhone,
    email: email.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.serviceModel === 'mobile_onsite' && b.travelRadiusKm === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Set how far you travel', path: ['travelRadiusKm'] });
    }
    if (b.serviceModel === 'fixed_location' && !b.addressLine1) {
      ctx.addIssue({ code: 'custom', message: 'Clients need your street address', path: ['addressLine1'] });
    }
  });

export const staffMemberSchema = z
  .object({
    displayName: plainText({ min: 1, max: 80, label: 'Display name' }),
    roleTitle: optionalPlainText({ max: 80, label: 'Role' }),
    inviteEmail: email.optional(),
    /** UI works in percent; stored as basis points. */
    commissionPercent: z.coerce.number().min(0).max(100).multipleOf(0.01),
    canViewClientNotes: z.boolean().default(false),
    canManageBookings: z.boolean().default(true),
    workingHours: workingHoursSchema.default({}),
  })
  .strict();

export const commissionUpdateSchema = z
  .object({
    staffId: uuid,
    commissionPercent: z.coerce.number().min(0).max(100).multipleOf(0.01),
  })
  .strict();

export const recordTipSchema = z
  .object({
    staffId: uuid,
    appointmentId: uuid.optional(),
    amount: randAmount.refine((c) => c >= 100, 'Minimum tip is R1'),
    method: z.enum(TIP_METHODS).exclude(['in_app']),
    note: optionalPlainText({ max: 280, label: 'Note' }),
  })
  .strict();

export const clientNoteSchema = z
  .object({
    businessId: uuid,
    clientId: uuid,
    body: plainText({ min: 1, max: 4000, multiline: true, label: 'Note' }),
  })
  .strict();

export const payoutAccountSchema = z
  .object({
    businessId: uuid,
    bankCode: z.string().regex(/^[A-Za-z0-9-]{2,20}$/),
    accountNumber: z.string().trim().regex(/^\d{6,16}$/, 'Account number must be 6–16 digits'),
  })
  .strict();

export type BusinessInput = z.input<typeof businessSchema>;
export type StaffMemberInput = z.input<typeof staffMemberSchema>;
export type StaffMemberData = z.output<typeof staffMemberSchema>;
export type RecordTipInput = z.input<typeof recordTipSchema>;
export type RecordTipData = z.output<typeof recordTipSchema>;
