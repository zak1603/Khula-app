'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { signUpSchema, type SignUpData, type SignUpInput } from '@khula/shared';
import { postJson } from '@/lib/api-client';
import { Button, Card, ErrorNotice, Field, Input } from '@/components/ui/primitives';

export function RegisterForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<SignUpInput, unknown, SignUpData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { accountType: 'business_owner', marketingOptIn: false },
  });

  const signUp = useMutation({
    mutationFn: (v: SignUpData) => postJson<{ emailConfirmationRequired: boolean }>('/api/auth/sign-up', v),
  });

  if (signUp.isSuccess) {
    return (
      <Card className="p-6 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-brand-600" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">If this address can be registered, we&apos;ve sent a confirmation link. Open it to activate your account.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">List your business on Khula</h1>
      <p className="mt-1 text-sm text-ink-muted">Bookings, quotes and payments for South African service pros.</p>
      <form className="mt-5 space-y-4" noValidate onSubmit={handleSubmit((v) => signUp.mutate(v))}>
        <input type="hidden" {...register('accountType')} />
        <Field label="Your full name" error={errors.fullName?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Mobile number (optional)" error={errors.phone?.message}>
          {(p) => <Input {...p} type="tel" autoComplete="tel" placeholder="082 123 4567" {...register('phone')} />}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="12+ characters with upper- and lower-case letters and a number.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Field label="Confirm password" error={errors.confirmPassword?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirmPassword')} />}
        </Field>

        <div className="space-y-2 rounded-xl bg-sand-50 p-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-sand-300" {...register('popiaConsent')} />
            <span>
              I agree to the <Link href="/legal/privacy" className="font-medium text-brand-700 underline">privacy notice</Link> and consent to Khula
              processing my personal information to provide the service (POPIA).
            </span>
          </label>
          {errors.popiaConsent?.message && <p role="alert" className="text-xs text-red-600">{errors.popiaConsent.message}</p>}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-sand-300" {...register('marketingOptIn')} />
            <span>Send me occasional product news (optional — you can opt out anytime).</span>
          </label>
        </div>

        <ErrorNotice error={signUp.error} />
        <Button type="submit" className="w-full" loading={signUp.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
