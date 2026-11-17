import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Sprout } from 'lucide-react-native';
import { messageForCode, signInSchema, type SignInInput } from '@khula/shared';
import { supabase } from '@/lib/supabase';
import { BeadStripe, Button, ErrorText, Input } from '@/components/ui';

export default function SignInScreen() {
  const { control, handleSubmit, formState: { errors } } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const signIn = useMutation({
    mutationFn: async (v: SignInInput) => {
      const { error } = await supabase.auth.signInWithPassword(v);
      // Supabase Auth applies its own per-IP rate limits; message stays generic (no enumeration).
      if (error) throw new Error(error.code === 'email_not_confirmed' ? 'Please confirm your email first.' : messageForCode('INVALID_CREDENTIALS'));
    },
    onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/')),
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 p-6" keyboardShouldPersistTaps="handled">
        <View className="mb-2 gap-4">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-800">
            <Sprout size={28} color="#f9b724" />
          </View>
          <View className="gap-1">
            <Text className="text-xs font-bold uppercase tracking-widest text-sun-600">Sawubona</Text>
            <Text className="text-3xl font-extrabold tracking-tight text-ink">Welcome back</Text>
            <Text className="text-base text-sand-500">Sign in to book trusted local pros.</Text>
          </View>
          <BeadStripe className="w-28" />
        </View>
        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <Input
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.email?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <Input
              label="Password"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.password?.message}
            />
          )}
        />
        <ErrorText error={signIn.error} />
        <Button title="Sign in" loading={signIn.isPending} onPress={() => void handleSubmit((v) => signIn.mutate(v))()} />
        <Link href="/(auth)/sign-up" className="mt-2 text-center text-sm font-medium text-brand-700">
          New here? Create an account
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
