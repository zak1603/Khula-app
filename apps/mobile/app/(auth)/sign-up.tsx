import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react-native';
import { POPIA_CONSENT_VERSION, signUpSchema, type SignUpData, type SignUpInput } from '@khula/shared';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { Button, ErrorText, Input } from '@/components/ui';

export default function SignUpScreen() {
  const [sent, setSent] = useState(false);
  const { control, handleSubmit, formState: { errors } } = useForm<SignUpInput, unknown, SignUpData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirmPassword: '', accountType: 'client', marketingOptIn: false },
  });

  const signUp = useMutation({
    mutationFn: async (v: SignUpData) => {
      const { error } = await supabase.auth.signUp({
        email: v.email,
        password: v.password,
        options: {
          emailRedirectTo: `${env.apiUrl}/auth/callback`,
          data: {
            full_name: v.fullName,
            phone: v.phone,
            account_type: 'client',
            popia_consent: true,
            popia_consent_version: POPIA_CONSENT_VERSION,
            marketing_opt_in: v.marketingOptIn,
          },
        },
      });
      if (error && error.code !== 'user_already_exists') throw new Error('We could not create your account. Please check your details.');
    },
    onSuccess: () => setSent(true), // same screen whether or not the email existed (anti-enumeration)
  });

  if (sent) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white p-8">
        <MailCheck size={44} color="#1a7e56" />
        <Text className="text-xl font-semibold">Check your email</Text>
        <Text className="text-center text-slate-500">Tap the confirmation link we sent, then come back and sign in.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 p-6 pb-12" keyboardShouldPersistTaps="handled">
        {(
          [
            ['fullName', 'Full name', { autoComplete: 'name', textContentType: 'name' }],
            ['email', 'Email', { autoCapitalize: 'none', keyboardType: 'email-address', autoComplete: 'email' }],
            ['phone', 'Mobile number (optional)', { keyboardType: 'phone-pad', autoComplete: 'tel', placeholder: '082 123 4567' }],
            ['password', 'Password', { secureTextEntry: true, autoComplete: 'new-password', textContentType: 'newPassword' }],
            ['confirmPassword', 'Confirm password', { secureTextEntry: true, autoComplete: 'new-password' }],
          ] as const
        ).map(([name, label, props]) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field }) => (
              <Input
                label={label}
                {...props}
                value={(field.value as string | undefined) ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors[name]?.message}
                hint={name === 'password' ? '12+ characters, upper- & lower-case letters and a number' : undefined}
              />
            )}
          />
        ))}

        <Controller
          control={control}
          name="popiaConsent"
          render={({ field }) => (
            <View className="flex-row items-start gap-3 rounded-xl bg-slate-50 p-3">
              <Switch value={field.value === true} onValueChange={(v) => field.onChange(v ? true : undefined)} accessibilityLabel="Accept privacy notice" />
              <Text className="flex-1 text-sm text-slate-700">
                I agree to the{' '}
                <Text className="font-semibold text-brand-700" onPress={() => Linking.openURL(`${env.apiUrl}/legal/privacy`)}>
                  privacy notice
                </Text>{' '}
                and consent to Khula processing my personal information to provide bookings (POPIA).
              </Text>
            </View>
          )}
        />
        {errors.popiaConsent?.message && <Text className="text-xs text-red-600">{errors.popiaConsent.message}</Text>}

        <Controller
          control={control}
          name="marketingOptIn"
          render={({ field }) => (
            <Pressable onPress={() => field.onChange(!field.value)} className="flex-row items-center gap-3 px-1">
              <Switch value={!!field.value} onValueChange={field.onChange} accessibilityLabel="Marketing opt-in" />
              <Text className="flex-1 text-sm text-slate-600">Send me occasional offers (optional)</Text>
            </Pressable>
          )}
        />

        <ErrorText error={signUp.error} />
        <Button title="Create account" loading={signUp.isPending} onPress={() => void handleSubmit((v) => signUp.mutate(v))()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
