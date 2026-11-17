import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronRight, CreditCard, Download, History, LogOut, ShieldAlert, Trash2 } from 'lucide-react-native';
import {
  eraseAccountSchema,
  formatDateTime,
  formatZar,
  optionalPlainText,
  optionalSaPhone,
  personName,
  type ClientDataExport,
  type EraseAccountInput,
} from '@khula/shared';
import { supabase } from '@/lib/supabase';
import { apiFetch, unwrap } from '@/lib/api';
import { mk, useMyBookings, usePaymentMethods, useProfile } from '@/hooks/queries';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, ErrorText, Input, SectionTitle, StatusPill } from '@/components/ui';

const profileSchema = z
  .object({
    fullName: personName,
    phone: optionalSaPhone,
    preferenceNotes: optionalPlainText({ max: 1000, multiline: true, label: 'Preferences' }),
  })
  .strict();
type ProfileIn = z.input<typeof profileSchema>;
type ProfileOut = z.output<typeof profileSchema>;

export default function ProfileScreen() {
  const { status, signOut, userId } = useAuth();
  const qc = useQueryClient();
  const profile = useProfile();
  const bookings = useMyBookings();
  const cards = usePaymentMethods();
  const [eraseOpen, setEraseOpen] = useState(false);

  const form = useForm<ProfileIn, unknown, ProfileOut>({ resolver: zodResolver(profileSchema) });
  useEffect(() => {
    if (profile.data) {
      form.reset({ fullName: profile.data.full_name ?? '', phone: profile.data.phone ?? '', preferenceNotes: profile.data.preference_notes ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async (v: ProfileOut) =>
      unwrap(
        await supabase
          .from('profiles')
          .update({ full_name: v.fullName, phone: v.phone ?? null, preference_notes: v.preferenceNotes ?? null })
          .eq('id', userId!),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: mk.profile }),
  });

  const exportData = useMutation({
    mutationFn: () => apiFetch<ClientDataExport>('/api/privacy/export'),
    onSuccess: (data) => Share.share({ title: 'My Khula data', message: JSON.stringify(data, null, 2) }),
  });

  if (status !== 'signed_in') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-sand-50 p-8">
        <Text className="text-center text-base text-sand-600">Sign in to manage your profile, history and saved cards.</Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/sign-in')} className="w-48" />
      </View>
    );
  }
  if (profile.isLoading) return <ActivityIndicator className="mt-20" color="#146b4f" />;

  const history = (bookings.data ?? []).filter((a) => a.status === 'completed' || a.status === 'cancelled').slice(0, 20);
  const errs = form.formState.errors;

  return (
    <ScrollView className="flex-1 bg-sand-50" contentContainerClassName="p-4 pb-16" keyboardShouldPersistTaps="handled">
      <SectionTitle>Your details</SectionTitle>
      <Card className="gap-3">
        <Controller control={form.control} name="fullName" render={({ field }) => (
          <Input label="Full name" value={(field.value as string) ?? ''} onChangeText={field.onChange} error={errs.fullName?.message} autoComplete="name" />
        )} />
        <Controller control={form.control} name="phone" render={({ field }) => (
          <Input label="Mobile number" value={(field.value as string) ?? ''} onChangeText={field.onChange} error={errs.phone?.message} keyboardType="phone-pad" />
        )} />
        <Controller control={form.control} name="preferenceNotes" render={({ field }) => (
          <Input
            label="Preferences & notes for providers"
            hint="e.g. allergies, gate code, preferred contact time. Shared with providers you book."
            value={(field.value as string) ?? ''}
            onChangeText={field.onChange}
            error={errs.preferenceNotes?.message}
            multiline
            className="min-h-24 py-3"
            textAlignVertical="top"
            maxLength={1000}
          />
        )} />
        <ErrorText error={save.error} />
        <Button title={save.isSuccess && !form.formState.isDirty ? 'Saved' : 'Save'} loading={save.isPending} disabled={!form.formState.isDirty} onPress={() => void form.handleSubmit((v) => save.mutate(v))()} />
      </Card>

      <SectionTitle>Saved payment methods</SectionTitle>
      <Card>
        {cards.data?.length ? (
          cards.data.map((c) => (
            <View key={c.id} className="flex-row items-center gap-3 py-2">
              <CreditCard size={20} color="#5f564a" />
              <View className="flex-1">
                <Text className="font-medium capitalize text-sand-900">
                  {c.brand ?? 'Card'} •••• {c.last4}
                </Text>
                <Text className="text-xs text-sand-500">
                  Expires {String(c.exp_month).padStart(2, '0')}/{c.exp_year} {c.bank ? `· ${c.bank}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove card ending ${c.last4}`}
                onPress={() =>
                  Alert.alert('Remove card?', 'The saved token will be permanently deleted.', [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => cards.remove.mutate(c.id) },
                  ])
                }
                className="rounded-lg p-2 active:bg-sand-100"
              >
                <Trash2 size={18} color="#dc2626" />
              </Pressable>
            </View>
          ))
        ) : (
          <Text className="text-sm text-sand-500">
            No saved cards. Cards are tokenised by Paystack — Khula never sees or stores your card number.
          </Text>
        )}
      </Card>

      <SectionTitle>History</SectionTitle>
      <Card>
        {history.length === 0 ? (
          <View className="flex-row items-center gap-2">
            <History size={16} color="#a89c88" />
            <Text className="text-sm text-sand-500">Completed bookings will appear here.</Text>
          </View>
        ) : (
          history.map((a) => (
            <Pressable key={a.id} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: a.id } })} className="flex-row items-center gap-3 border-b border-sand-100 py-3 last:border-b-0">
              <View className="flex-1 gap-0.5">
                <Text className="font-medium text-sand-900">{a.service?.title}</Text>
                <Text className="text-xs text-sand-500">{formatDateTime(a.starts_at)}</Text>
              </View>
              <View className="items-end gap-1">
                <StatusPill status={a.status} />
                {a.total_price_cents !== null && a.status === 'completed' && <Text className="text-xs font-semibold">{formatZar(a.total_price_cents)}</Text>}
              </View>
              <ChevronRight size={16} color="#d6ccbc" />
            </Pressable>
          ))
        )}
      </Card>

      <SectionTitle>Privacy (POPIA)</SectionTitle>
      <Card className="gap-2">
        <Button title="Download my data" variant="secondary" icon={<Download size={18} color="#1d1a16" />} loading={exportData.isPending} onPress={() => exportData.mutate()} />
        <ErrorText error={exportData.error} />
        <Button title="Delete my account" variant="ghost" icon={<ShieldAlert size={18} color="#dc2626" />} onPress={() => setEraseOpen(true)} />
      </Card>

      <Button title="Sign out" variant="ghost" className="mt-6" icon={<LogOut size={18} color="#5f564a" />} onPress={signOut} />

      <EraseAccountModal open={eraseOpen} onClose={() => setEraseOpen(false)} />
    </ScrollView>
  );
}

function EraseAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const erase = useMutation({
    mutationFn: async (v: EraseAccountInput) => {
      const body = eraseAccountSchema.parse(v);
      await apiFetch('/api/privacy/erase', { method: 'POST', body });
      await supabase.auth.signOut({ scope: 'local' });
    },
    onSuccess: () => {
      onClose();
      router.replace('/');
    },
  });

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 gap-4 bg-white p-6">
        <Text className="text-xl font-bold text-red-700">Delete your account</Text>
        <Text className="text-sm text-sand-600">
          This permanently removes your name, contact details, addresses, saved cards and provider notes about you. Payment records are kept in
          anonymised form for 5 years as required by South African tax law. Cancel upcoming bookings first.
        </Text>
        <Input label="Confirm with your password" secureTextEntry value={password} onChangeText={setPassword} autoComplete="current-password" />
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-sand-800">Type DELETE MY ACCOUNT</Text>
          <TextInput value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" className="min-h-12 rounded-xl border border-sand-300 px-3.5 text-base" />
        </View>
        <ErrorText error={erase.error} />
        <Button
          title="Permanently delete"
          variant="danger"
          disabled={confirmation !== 'DELETE MY ACCOUNT' || !password}
          loading={erase.isPending}
          onPress={() => erase.mutate({ password, confirmation: 'DELETE MY ACCOUNT' })}
        />
        <Button title="Keep my account" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
