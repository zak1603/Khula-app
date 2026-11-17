import { z } from 'zod';
import { optionalPlainText, uuid } from './primitives';

export const initializePaymentSchema = z
  .object({
    appointmentId: uuid,
    type: z.enum(['deposit', 'balance', 'tip']),
    tipCents: z.number().int().min(500, 'Minimum tip is R5').max(500_000, 'Maximum tip is R5 000').optional(),
    saveCard: z.boolean().default(false),
    paymentMethodId: uuid.optional(),
  })
  .strict()
  .refine((p) => p.type !== 'tip' || p.tipCents !== undefined, { message: 'Choose a tip amount', path: ['tipCents'] });

export const eraseAccountSchema = z
  .object({
    password: z.string().min(1, 'Confirm with your password').max(128),
    confirmation: z.literal('DELETE MY ACCOUNT', { error: 'Type DELETE MY ACCOUNT to confirm' }),
    reason: optionalPlainText({ max: 200, label: 'Reason' }),
  })
  .strict();

export type InitializePaymentInput = z.input<typeof initializePaymentSchema>;
export type EraseAccountInput = z.input<typeof eraseAccountSchema>;
