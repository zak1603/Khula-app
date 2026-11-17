import { z } from 'zod';
import { PRICING_MODELS } from '../types';
import { isoDateTime, optionalPlainText, percent, plainText, randAmount, uuid } from './primitives';

const optionalRand = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  randAmount.optional(),
);

export const serviceSchema = z
  .object({
    title: plainText({ min: 2, max: 120, label: 'Title' }),
    description: optionalPlainText({ max: 2000, multiline: true, label: 'Description' }),
    categoryId: z.coerce.number().int().positive().optional(),
    pricingModel: z.enum(PRICING_MODELS),
    /** Rand amount entered by the provider → cents. "From" price for quotes. */
    price: optionalRand,
    durationMinutes: z.coerce.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours'),
    bufferMinutes: z.coerce.number().int().min(0).max(240).default(0),
    depositPercent: percent.default(0),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.pricingModel === 'instant_book' && s.price === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Instant-book services need a fixed price', path: ['price'] });
    }
    if (s.depositPercent > 0 && s.pricingModel === 'instant_book' && (s.price ?? 0) === 0) {
      ctx.addIssue({ code: 'custom', message: 'Free services cannot take a deposit', path: ['depositPercent'] });
    }
  });

export const pricingToggleSchema = z
  .object({ serviceId: uuid, pricingModel: z.enum(PRICING_MODELS) })
  .strict();

export const submitQuoteSchema = z
  .object({
    appointmentId: uuid,
    amount: randAmount.refine((c) => c >= 100, 'Minimum quote is R1'),
    message: optionalPlainText({ max: 2000, multiline: true, label: 'Message' }),
    validHours: z.coerce.number().int().min(1).max(336).default(72),
    proposedStartsAt: isoDateTime.optional(),
    proposedStaffId: uuid.optional(),
  })
  .strict();

export const respondToQuoteSchema = z.object({ quoteId: uuid, accept: z.boolean() }).strict();

export type ServiceInput = z.input<typeof serviceSchema>;
export type ServiceData = z.output<typeof serviceSchema>;
export type SubmitQuoteInput = z.input<typeof submitQuoteSchema>;
export type SubmitQuoteData = z.output<typeof submitQuoteSchema>;
