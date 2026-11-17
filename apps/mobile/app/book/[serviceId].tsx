import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeIn, FadeOut, SlideInRight } from 'react-native-reanimated';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LocateFixed, MapPin, ShieldCheck } from 'lucide-react-native';
import {
  addDays,
  bookingAddressSchema,
  createBookingSchema,
  formatDate,
  formatDateTime,
  formatTime,
  formatZar,
  isWithinTravelRadius,
  saLocalToIso,
  toSaDate,
  type BookingAddress,
  type CreateBookingResponse,
} from '@khula/shared';
import { apiFetch, initializePayment } from '@/lib/api';
import { useAvailableSlots, useBookableStaff, useBusinessPublic, useService, mk } from '@/hooks/queries';
import { geocodeAddress, reverseGeocode, useDeviceLocation } from '@/hooks/use-location';
import { useBookingFlow, type BookingStep } from '@/stores/booking-flow-store';
import { Button, Card, Chip, ErrorText, Input } from '@/components/ui';

const STEP_TITLES: Record<BookingStep, string> = {
  staff: 'Choose a professional',
  time: 'Pick a time',
  location: 'Where should they come?',
  details: 'Describe the job',
  review: 'Review & confirm',
};

export default function BookingFlowScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const flow = useBookingFlow();
  const service = useService(serviceId);
  const business = useBusinessPublic(service.data?.business_id);
  const staff = useBookableStaff(service.data?.business_id);

  useEffect(() => {
    if (serviceId) flow.start(serviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const isMobile = business.data?.service_model === 'mobile_onsite';
  const isQuote = service.data?.pricing_model === 'quote_required';

  // The flow adapts to the business model and pricing model.
  const steps = useMemo<BookingStep[]>(() => {
    const s: BookingStep[] = [];
    if ((staff.data?.length ?? 0) > 1) s.push('staff');
    if (isMobile) s.push('location'); // location first: no point picking a time if they can't reach you
    s.push('time');
    if (isQuote) s.push('details');
    s.push('review');
    return s;
  }, [staff.data, isMobile, isQuote]);

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = () => (stepIndex === 0 ? router.back() : setStepIndex((i) => i - 1));

  if (service.isLoading || business.isLoading || staff.isLoading) return <ActivityIndicator className="mt-20" color="#146b4f" />;
  if (!service.data || !business.data) return <ErrorText error={service.error ?? business.error ?? new Error('Service unavailable')} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-sand-50">
      {/* Progress */}
      <View className="flex-row gap-1.5 px-4 pt-3">
        {steps.map((s, i) => (
          <View key={s} className={i <= stepIndex ? 'h-1 flex-1 rounded-full bg-brand-500' : 'h-1 flex-1 rounded-full bg-sand-200'} />
        ))}
      </View>
      <Text className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-sand-400">
        {service.data.title} · {business.data.name}
      </Text>
      <Text className="px-4 pb-2 text-2xl font-bold text-sand-900">{STEP_TITLES[step]}</Text>

      <Animated.View key={step} entering={SlideInRight.springify().damping(20)} exiting={FadeOut.duration(120)} className="flex-1">
        {step === 'staff' && <StaffStep staff={staff.data ?? []} onNext={next} />}
        {step === 'location' && (
          <LocationStep
            base={{ lat: business.data.latitude, lng: business.data.longitude }}
            radiusKm={Number(business.data.travel_radius_km ?? 0)}
            onNext={next}
          />
        )}
        {step === 'time' && <TimeStep serviceId={service.data.id} onNext={next} />}
        {step === 'details' && <DetailsStep onNext={next} />}
        {step === 'review' && (
          <ReviewStep
            service={service.data}
            businessName={business.data.name}
            acceptsPayments={business.data.accepts_payments}
            staffName={staff.data?.find((s) => s.staff_id === (flow.slotStaffId ?? flow.staffId))?.display_name}
          />
        )}
      </Animated.View>

      {step !== 'review' && (
        <Pressable onPress={back} className="items-center pb-6">
          <Text className="text-sm font-medium text-sand-500">Back</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------------- steps
function StaffStep({ staff, onNext }: { staff: Array<{ staff_id: string; display_name: string; role_title: string | null }>; onNext: () => void }) {
  const { staffId, set } = useBookingFlow();
  return (
    <ScrollView contentContainerClassName="gap-2 p-4">
      {[{ staff_id: null as string | null, display_name: 'Any available professional', role_title: 'Fastest option' }, ...staff].map((s) => (
        <Pressable
          key={s.staff_id ?? 'any'}
          accessibilityRole="radio"
          accessibilityState={{ checked: staffId === s.staff_id }}
          onPress={() => {
            set({ staffId: s.staff_id, slotStart: null, slotStaffId: null });
            onNext();
          }}
          className={staffId === s.staff_id ? 'rounded-2xl border-2 border-brand-500 bg-brand-50 p-4' : 'rounded-2xl border border-sand-200 bg-white p-4'}
        >
          <Text className="text-base font-semibold text-sand-900">{s.display_name}</Text>
          {s.role_title && <Text className="text-sm text-sand-500">{s.role_title}</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function TimeStep({ serviceId, onNext }: { serviceId: string; onNext: () => void }) {
  const { date, staffId, slotStart, set } = useBookingFlow();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(toSaDate(), i)), []);
  const slots = useAvailableSlots(serviceId, date, staffId);

  return (
    <View className="flex-1">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-2" className="max-h-20 flex-grow-0">
        {days.map((d) => {
          const [wd, day] = formatDate(saLocalToIso(d, '12:00')).split(' ');
          const sel = d === date;
          return (
            <Pressable
              key={d}
              onPress={() => set({ date: d, slotStart: null, slotStaffId: null })}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              className={sel ? 'w-14 items-center rounded-xl bg-brand-600 py-2' : 'w-14 items-center rounded-xl border border-sand-200 bg-white py-2'}
            >
              <Text className={sel ? 'text-xs text-brand-100' : 'text-xs text-sand-500'}>{wd?.replace(',', '')}</Text>
              <Text className={sel ? 'text-lg font-bold text-white' : 'text-lg font-bold text-sand-900'}>{day}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerClassName="flex-row flex-wrap gap-2 p-4">
        {slots.isLoading && <ActivityIndicator className="w-full" color="#146b4f" />}
        <ErrorText error={slots.error} />
        {slots.data?.length === 0 && <Text className="w-full py-8 text-center text-sand-500">No free times on this day. Try another date.</Text>}
        {slots.data?.map((s) => (
          <Chip
            key={`${s.staff_id}-${s.slot_start}`}
            label={formatTime(s.slot_start)}
            selected={slotStart === s.slot_start}
            onPress={() => set({ slotStart: s.slot_start, slotStaffId: staffId ? s.staff_id : null })}
          />
        ))}
      </ScrollView>
      <View className="p-4">
        <Button title="Continue" disabled={!slotStart} onPress={onNext} />
      </View>
    </View>
  );
}

function LocationStep({ base, radiusKm, onNext }: { base: { lat: number; lng: number }; radiusKm: number; onNext: () => void }) {
  const flow = useBookingFlow();
  const device = useDeviceLocation();
  const [form, setForm] = useState({
    line1: flow.address?.line1 ?? '',
    line2: flow.address?.line2 ?? '',
    suburb: flow.address?.suburb ?? '',
    city: flow.address?.city ?? '',
    postalCode: flow.address?.postalCode ?? '',
  });
  const [point, setPoint] = useState(flow.address ? { lat: flow.address.lat, lng: flow.address.lng } : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function useCurrent() {
    setError(null);
    const p = await device.request();
    if (!p) return;
    setPoint(p);
    const addr = await reverseGeocode(p).catch(() => null);
    if (addr) setForm((f) => ({ ...f, ...addr }));
  }

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      // Geocode typed addresses (or re-geocode if the user edited the street).
      const p = point ?? (await geocodeAddress(form).catch(() => null));
      if (!p) return setError("We couldn't find that address. Check the street and suburb.");
      const parsed = bookingAddressSchema.safeParse({ ...form, line2: form.line2 || undefined, lat: p.lat, lng: p.lng });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Please check your address.');
      // Client-side pre-check for instant feedback; the server re-checks with PostGIS.
      if (!isWithinTravelRadius(base, p, radiusKm)) {
        return setError(`This provider only travels up to ${radiusKm} km — your address is outside their area.`);
      }
      flow.set({ address: parsed.data as BookingAddress });
      onNext();
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof form, label: string, extra: object = {}) => (
    <Input
      label={label}
      value={form[k]}
      onChangeText={(v) => {
        setForm((f) => ({ ...f, [k]: v }));
        if (k !== 'line2') setPoint(null); // typed changes invalidate the GPS point
      }}
      {...extra}
    />
  );

  return (
    <ScrollView contentContainerClassName="gap-3 p-4" keyboardShouldPersistTaps="handled">
      <Button title="Use my current location" variant="secondary" loading={device.status === 'loading'} icon={<LocateFixed size={18} color="#115641" />} onPress={useCurrent} />
      {device.status === 'denied' && <Text className="text-xs text-sand-500">Location is off — type your address instead.</Text>}
      {field('line1', 'Street address', { autoComplete: 'street-address' })}
      {field('line2', 'Unit / complex (optional)')}
      <View className="flex-row gap-3">
        <View className="flex-1">{field('suburb', 'Suburb')}</View>
        <View className="w-28">{field('postalCode', 'Postal code', { keyboardType: 'number-pad', maxLength: 4 })}</View>
      </View>
      {field('city', 'City')}
      {point && (
        <Animated.View entering={FadeIn} className="flex-row items-center gap-2">
          <MapPin size={14} color="#146b4f" />
          <Text className="text-xs text-sand-500">Location pinned</Text>
        </Animated.View>
      )}
      {error && (
        <View className="flex-row items-start gap-2 rounded-xl bg-sun-50 p-3">
          <AlertTriangle size={16} color="#b0540a" />
          <Text className="flex-1 text-sm text-sun-800">{error}</Text>
        </View>
      )}
      <View className="flex-row items-start gap-2 rounded-xl bg-sand-100 p-3">
        <ShieldCheck size={16} color="#5f564a" />
        <Text className="flex-1 text-xs text-sand-600">Your address is shared only with this provider for this job and deleted automatically 90 days after it&apos;s done.</Text>
      </View>
      <Button title="Continue" loading={busy} onPress={confirm} />
    </ScrollView>
  );
}

function DetailsStep({ onNext }: { onNext: () => void }) {
  const { message, set } = useBookingFlow();
  return (
    <View className="flex-1 gap-3 p-4">
      <Text className="text-sm text-sand-600">The more detail you give, the more accurate your quote. Mention make/model, size, symptoms, access, etc.</Text>
      <TextInput
        multiline
        value={message}
        onChangeText={(v) => set({ message: v })}
        maxLength={1000}
        placeholder="e.g. 2015 VW Polo, engine light on, battery seems weak…"
        placeholderTextColor="#a89c88"
        className="min-h-40 rounded-xl border border-sand-300 bg-white p-3 text-base text-sand-900"
        textAlignVertical="top"
        accessibilityLabel="Job description"
      />
      <Text className="text-right text-xs text-sand-400">{message.length}/1000</Text>
      <Button title="Continue" disabled={message.trim().length < 10} onPress={onNext} />
    </View>
  );
}

function ReviewStep({
  service,
  businessName,
  acceptsPayments,
  staffName,
}: {
  service: { id: string; title: string; pricing_model: string; price_cents: number | null; deposit_percent: number; duration_minutes: number };
  businessName: string;
  acceptsPayments: boolean;
  staffName?: string;
}) {
  const flow = useBookingFlow();
  const qc = useQueryClient();
  const isQuote = service.pricing_model === 'quote_required';
  const deposit = !isQuote && service.price_cents ? Math.round((service.price_cents * service.deposit_percent) / 100) : 0;

  const book = useMutation({
    mutationFn: async () => {
      const payload = createBookingSchema.parse({
        serviceId: service.id,
        staffId: flow.slotStaffId ?? flow.staffId,
        startsAt: flow.slotStart,
        address: flow.address ?? undefined,
        message: flow.message || undefined,
        idempotencyKey: flow.idempotencyKey,
      });
      const res = await apiFetch<CreateBookingResponse>('/api/bookings', { method: 'POST', body: payload });

      if (res.paymentRequired && acceptsPayments) {
        const pay = await initializePayment({ appointmentId: res.appointment.id, type: 'deposit', saveCard: false });
        if (pay.mode === 'redirect') {
          // System browser auth session: card details never touch our app (PCI scope stays with Paystack).
          await WebBrowser.openAuthSessionAsync(pay.authorizationUrl, 'khula://payments/complete');
        }
      }
      return res;
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: mk.myBookings });
      flow.reset();
      router.dismissAll();
      router.push({ pathname: '/booking/[id]', params: { id: res.appointment.id } });
    },
  });

  return (
    <ScrollView contentContainerClassName="gap-4 p-4">
      <Card>
        <Row label="Service" value={service.title} />
        <Row label="With" value={`${staffName ?? 'Any available professional'} · ${businessName}`} />
        <Row label={isQuote ? 'Preferred time' : 'When'} value={flow.slotStart ? formatDateTime(flow.slotStart) : '—'} />
        <Row label="Duration" value={`${service.duration_minutes} min`} />
        {flow.address && <Row label="Address" value={[flow.address.line1, flow.address.suburb, flow.address.city].join(', ')} />}
        {flow.message ? <Row label="Details" value={flow.message} /> : null}
        <View className="my-3 h-px bg-sand-100" />
        {isQuote ? (
          <Text className="text-sm text-sand-600">No charge now. {businessName} will send you a quote to accept or decline.</Text>
        ) : (
          <>
            <Row label="Price" value={formatZar(service.price_cents)} bold />
            {deposit > 0 && <Row label="Deposit due now" value={formatZar(deposit)} />}
          </>
        )}
      </Card>

      {deposit > 0 && (
        <Text className="text-xs text-sand-500">
          Your slot is held for 15 minutes while you pay the deposit securely with Paystack. Free cancellation up to 24 hours before.
        </Text>
      )}
      <ErrorText error={book.error} />
      <Button
        title={isQuote ? 'Request quote' : deposit > 0 ? `Book & pay ${formatZar(deposit)}` : 'Confirm booking'}
        loading={book.isPending}
        icon={<CheckCircle2 size={18} color="#fff" />}
        onPress={() => book.mutate()}
      />
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between gap-4 py-1.5">
      <Text className="text-sm text-sand-500">{label}</Text>
      <Text className={bold ? 'flex-1 text-right text-base font-bold text-sand-900' : 'flex-1 text-right text-sm text-sand-900'}>{value}</Text>
    </View>
  );
}
