import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeInUp, LinearTransition } from 'react-native-reanimated';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, CreditCard, HandHeart, MapPin, MessageSquareQuote, Radio } from 'lucide-react-native';
import {
  DEPOSIT_LABEL,
  formatDateTime,
  formatTime,
  formatZar,
  type Appointment,
  type AppointmentEvent,
  type AppointmentQuote,
} from '@khula/shared';
import { supabase } from '@/lib/supabase';
import { initializePayment, unwrap } from '@/lib/api';
import { mk, useBookableStaff, useBusinessPublic } from '@/hooks/queries';
import { Button, Card, Chip, ErrorText, Pill, SectionTitle, StatusPill } from '@/components/ui';
import { StatusTimeline } from '@/components/status-timeline';

type BookingDetail = Appointment & {
  service: { title: string; duration_minutes: number } | null;
  quotes: AppointmentQuote[];
  events: AppointmentEvent[];
};

const TIP_OPTIONS = [2000, 5000, 10000]; // R20, R50, R100

export default function BookingTrackerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  const booking = useQuery({
    queryKey: mk.booking(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('appointments')
          .select(
            '*, service:services!appointments_service_fk(title,duration_minutes), quotes:appointment_quotes(*), events:appointment_events(*)',
          )
          .eq('id', id!)
          .order('created_at', { referencedTable: 'appointment_quotes', ascending: false })
          .order('created_at', { referencedTable: 'appointment_events', ascending: true })
          .single(),
      ) as unknown as BookingDetail,
  });
  const a = booking.data;
  const business = useBusinessPublic(a?.business_id);
  const staff = useBookableStaff(a?.business_id);
  const staffName = staff.data?.find((s) => s.staff_id === a?.staff_id)?.display_name;

  // ---------------- Realtime: booking row, quotes and timeline events (RLS-filtered server-side)
  useEffect(() => {
    if (!id) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: mk.booking(id) });
      void qc.invalidateQueries({ queryKey: mk.myBookings });
    };
    const channel = supabase
      .channel(`booking:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: `id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_quotes', filter: `appointment_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointment_events', filter: `appointment_id=eq.${id}` }, refresh)
      .subscribe((s) => setLive(s === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: mk.booking(id ?? '') });

  const respond = useMutation({
    mutationFn: async (v: { quoteId: string; accept: boolean }) => unwrap(await supabase.rpc('respond_to_quote', { p_quote_id: v.quoteId, p_accept: v.accept })),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: async (reason: string) =>
      unwrap(await supabase.rpc('update_appointment_status', { p_appointment_id: id!, p_status: 'cancelled', p_reason: reason })),
    onSuccess: invalidate,
  });

  const pay = useMutation({
    mutationFn: async (v: { type: 'deposit' | 'balance' | 'tip'; tipCents?: number }) => {
      const res = await initializePayment({ appointmentId: id!, type: v.type, tipCents: v.tipCents, saveCard: true });
      if (res.mode === 'redirect') await WebBrowser.openAuthSessionAsync(res.authorizationUrl, 'khula://payments/complete');
      return res;
    },
    // The confirmed state arrives via realtime once the signed webhook settles.
    onSettled: invalidate,
  });

  if (booking.isLoading) return <ActivityIndicator className="mt-20" color="#146b4f" />;
  if (!a) return <ErrorText error={booking.error ?? new Error('Booking not found')} />;

  const pendingQuote = a.quotes.find((q) => q.status === 'pending');
  const deposit = a.deposit_status === 'pending' && a.hold_expires_at;
  const lateCancel = a.deposit_status === 'paid' && Date.parse(a.starts_at) - Date.now() < 24 * 3600_000;
  const open = ['requested', 'quoted', 'confirmed'].includes(a.status);

  function confirmCancel() {
    Alert.alert(
      'Cancel booking?',
      lateCancel
        ? 'This is within 24 hours of your booking, so the deposit is non-refundable.'
        : a?.deposit_status === 'paid'
          ? 'Your deposit will be refunded.'
          : 'The provider will be notified.',
      [
        { text: 'Keep booking', style: 'cancel' },
        { text: 'Cancel booking', style: 'destructive', onPress: () => cancel.mutate('Cancelled by client') },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-sand-50"
      contentContainerClassName="gap-4 p-4 pb-16"
      refreshControl={<RefreshControl refreshing={booking.isRefetching} onRefresh={() => void booking.refetch()} tintColor="#146b4f" />}
    >
      <Card>
        <View className="flex-row items-start justify-between">
          <View className="flex-1 gap-1">
            <Text className="text-lg font-bold text-sand-900">{a.service?.title}</Text>
            <Text className="text-sm text-sand-500">{business.data?.name}{staffName ? ` · ${staffName}` : ''}</Text>
          </View>
          <StatusPill status={a.status} />
        </View>
        <View className="mt-3 gap-1.5">
          <View className="flex-row items-center gap-2">
            <Clock size={14} color="#7a6f5e" />
            <Text className="text-sm text-sand-700">{formatDateTime(a.starts_at)}</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <MapPin size={14} color="#7a6f5e" />
            <Text className="flex-1 text-sm text-sand-700">
              {a.is_mobile
                ? [a.client_address_line1, a.client_suburb].filter(Boolean).join(', ') || 'Your address'
                : [business.data?.address_line1, business.data?.suburb].filter(Boolean).join(', ')}
            </Text>
          </View>
        </View>
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          {a.total_price_cents !== null && <Pill tone="brand">{formatZar(a.total_price_cents)}</Pill>}
          {a.deposit_status !== 'not_required' && <Pill tone={a.deposit_status === 'paid' ? 'brand' : 'amber'}>{DEPOSIT_LABEL[a.deposit_status]}</Pill>}
          <View className="ml-auto flex-row items-center gap-1">
            <Radio size={12} color={live ? '#1f8462' : '#a89c88'} />
            <Text className={live ? 'text-xs text-brand-600' : 'text-xs text-sand-400'}>{live ? 'Live' : 'Connecting…'}</Text>
          </View>
        </View>
      </Card>

      {/* Quote awaiting response */}
      {pendingQuote && a.status === 'quoted' && (
        <Animated.View entering={FadeInUp.springify()}>
          <Card className="border-violet-300 bg-violet-50">
            <View className="flex-row items-center gap-2">
              <MessageSquareQuote size={18} color="#6d28d9" />
              <Text className="text-base font-semibold text-violet-900">Quote: {formatZar(pendingQuote.amount_cents)}</Text>
            </View>
            {pendingQuote.message && <Text className="mt-2 text-sm text-violet-900">{pendingQuote.message}</Text>}
            {pendingQuote.proposed_starts_at && (
              <Text className="mt-2 text-sm text-violet-800">Proposed time: {formatDateTime(pendingQuote.proposed_starts_at)}</Text>
            )}
            <Text className="mt-2 text-xs text-violet-700">Valid until {formatDateTime(pendingQuote.valid_until)}</Text>
            <ErrorText error={respond.error} />
            <View className="mt-3 flex-row gap-2">
              <Button title="Decline" variant="secondary" className="flex-1" loading={respond.isPending && respond.variables?.accept === false} onPress={() => respond.mutate({ quoteId: pendingQuote.id, accept: false })} />
              <Button title="Accept" className="flex-1" loading={respond.isPending && respond.variables?.accept === true} onPress={() => respond.mutate({ quoteId: pendingQuote.id, accept: true })} />
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Deposit due (instant book or accepted quote) */}
      {deposit && open && (
        <Card className="border-sun-300 bg-sun-50">
          <Text className="font-semibold text-sun-900">Pay {formatZar(a.deposit_cents)} deposit to confirm</Text>
          <Text className="mt-1 text-xs text-sun-800">Slot held until {formatTime(a.hold_expires_at!)}.</Text>
          <ErrorText error={pay.error} />
          <Button title="Pay securely" className="mt-3" icon={<CreditCard size={18} color="#fff" />} loading={pay.isPending} onPress={() => pay.mutate({ type: 'deposit' })} />
        </Card>
      )}

      <SectionTitle>Status</SectionTitle>
      <Card>
        <StatusTimeline status={a.status} progress={a.progress} isMobile={a.is_mobile} />
      </Card>

      <SectionTitle>Activity</SectionTitle>
      <Card>
        {a.events.map((e) => (
          <Animated.View key={e.id} layout={LinearTransition} entering={FadeInUp} className="flex-row gap-3 py-1.5">
            <Text className="w-12 text-xs tabular-nums text-sand-400">{formatTime(e.created_at)}</Text>
            <Text className="flex-1 text-sm text-sand-700">{describeEvent(e)}</Text>
          </Animated.View>
        ))}
      </Card>

      {a.status === 'completed' && a.staff_id && business.data?.accepts_payments && (
        <Card>
          <View className="flex-row items-center gap-2">
            <HandHeart size={18} color="#146b4f" />
            <Text className="font-semibold">Leave a tip{staffName ? ` for ${staffName}` : ''}</Text>
          </View>
          <Text className="mt-1 text-xs text-sand-500">100% goes to your professional.</Text>
          <View className="mt-3 flex-row gap-2">
            {TIP_OPTIONS.map((c) => (
              <Chip key={c} label={formatZar(c)} onPress={() => pay.mutate({ type: 'tip', tipCents: c })} />
            ))}
          </View>
        </Card>
      )}

      {open && <Button title="Cancel booking" variant="ghost" loading={cancel.isPending} onPress={confirmCancel} />}
      <ErrorText error={cancel.error} />
    </ScrollView>
  );
}

function describeEvent(e: AppointmentEvent): string {
  switch (e.event_type) {
    case 'created':
      return 'Booking requested';
    case 'status_changed':
      return e.to_status === 'cancelled' ? `Cancelled${e.note ? ` — ${e.note}` : ''}` : `Status: ${e.to_status}`;
    case 'progress_changed':
      return e.to_progress === 'en_route' ? 'Your provider is on the way' : e.to_progress === 'arrived' ? 'Provider has arrived' : e.to_progress === 'in_progress' ? 'Job in progress' : 'Progress updated';
    case 'quote_sent':
      return e.note ?? 'Quote sent';
    case 'quote_responded':
      return e.note ?? 'Quote answered';
    case 'payment_received':
      return e.note ?? 'Payment received';
    case 'rescheduled':
      return e.note ?? 'Rescheduled';
    default:
      return 'Updated';
  }
}
