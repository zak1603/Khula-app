import { z } from 'zod';
import { email, optionalSaPhone, password, personName } from './primitives';

export const signInSchema = z
  .object({
    email,
    // No complexity rules on sign-in: never reveal policy details to attackers.
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export const signUpSchema = z
  .object({
    fullName: personName,
    email,
    phone: optionalSaPhone,
    password,
    confirmPassword: z.string(),
    accountType: z.enum(['client', 'business_owner']),
    // POPIA s11: consent must be explicit, informed and recorded.
    popiaConsent: z.literal(true, { error: 'You must accept the privacy notice to continue' }),
    marketingOptIn: z.boolean().default(false),
  })
  .strict()
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => !d.password.toLowerCase().includes(d.email.split('@')[0] ?? '\u0000'), {
    message: "Password can't contain your email name",
    path: ['password'],
  });

export const passwordResetRequestSchema = z.object({ email }).strict();

export const updatePasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .strict()
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpData = z.output<typeof signUpSchema>;
