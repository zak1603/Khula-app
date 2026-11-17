'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { signInSchema, type AuthResponse, type SignInInput } from '@khula/shared';
import { postJson } from '@/lib/api-client';
import { safeRedirectPath } from '@/lib/utils';
import { Button, Card, ErrorNotice, Field, Input } from '@/components/ui/primitives';

const NOTICES: Record<string, string> = {
  providers_only: 'The dashboard is for service providers. Clients can book in the Khula app.',
  link_invalid: 'That link is invalid or has expired. Please sign in again.',
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const notice = NOTICES[params.get('error') ?? ''];
  const { register, handleSubmit, formState: { errors } } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  const signIn = useMutation({
    mutationFn: (v: SignInInput) => postJson<AuthResponse>('/api/auth/sign-in', v),
    onSuccess: () => {
      router.replace(safeRedirectPath(params.get('next')));
      router.refresh();
    },
  });

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Sign in to your business</h1>
      {notice && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}
      <form className="mt-5 space-y-4" noValidate onSubmit={handleSubmit((v) => signIn.mutate(v))}>
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        <ErrorNotice error={signIn.error} />
        <Button type="submit" className="w-full" loading={signIn.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        New to Khula?{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          List your business
        </Link>
      </p>
    </Card>
  );
}
