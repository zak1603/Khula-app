'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KhulaApiError,
  addDays,
  extractDbErrorCode,
  httpStatusForDbError,
  messageForCode,
  saLocalToIso,
  type AppointmentWithRelations,
  type DashboardStats,
  type StaffEarningsRow,
} from '@khula/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const sb = () => getSupabaseBrowserClient();

/** Turns a PostgREST error into a typed, user-safe error (typed from the whole response). */
function unwrap<R extends { data: unknown; error: { code?: string; message?: string } | null }>(res: R): NonNullable<R['data']> {
  if (res.error) {
    const code = extractDbErrorCode(res.error.message);
    throw new KhulaApiError(httpStatusForDbError(res.error.code), code, messageForCode(code));
  }
  return res.data as NonNullable<R['data']>;
}

export const qk = {
  businesses: ['businesses'] as const,
  stats: (b: string, d: string) => ['stats', b, d] as const,
  dayAppointments: (b: string, d: string) => ['appointments', b, 'day', d] as const,
  upcoming: (b: string) => ['appointments', b, 'upcoming'] as const,
  quoteInbox: (b: string) => ['appointments', b, 'quotes'] as const,
  staff: (b: string) => ['staff', b] as const,
  services: (b: string) => ['services', b] as const,
  tips: (b: string) => ['tips', b] as const,
  earnings: (b: string, from: string, to: string) => ['earnings', b, from, to] as const,
  categories: ['categories'] as const,
};

const APPOINTMENT_SELECT =
  '*, service:services!appointments_service_fk(id,title,duration_minutes,pricing_model), staff:staff_members!appointments_staff_fk(id,display_name), client:profiles!appointments_client_id_fkey(id,full_name,phone)';

// ------------------------------------------------------------------ reads
export function useBusinesses() {
  return useQuery({
    queryKey: qk.businesses,
    queryFn: async () =>
      unwrap(
        await sb()
          .from('businesses')
          .select('id, name, slug, owner_id, service_model, is_verified, is_active, paystack_subaccount_code, payout_bank_name, payout_account_last4, platform_fee_bps')
          .eq('is_active', true)
          .order('created_at'),
      ),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    staleTime: 60 * 60_000,
    queryFn: async () => unwrap(await sb().from('categories').select('*').order('sort_order')),
  });
}

export function useDashboardStats(businessId: string | null, date: string) {
  return useQuery({
    queryKey: qk.stats(businessId ?? '', date),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(await sb().rpc('get_business_dashboard_stats', { p_business_id: businessId!, p_date: date })) as DashboardStats,
  });
}

export function useDayAppointments(businessId: string | null, date: string) {
  return useQuery({
    queryKey: qk.dayAppointments(businessId ?? '', date),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(
        await sb()
          .from('appointments')
          .select(APPOINTMENT_SELECT)
          .eq('business_id', businessId!)
          .gte('starts_at', saLocalToIso(date, '00:00'))
          .lt('starts_at', saLocalToIso(addDays(date, 1), '00:00'))
          .order('starts_at'),
      ) as unknown as AppointmentWithRelations[],
  });
}

export function useUpcomingAppointments(businessId: string | null) {
  return useQuery({
    queryKey: qk.upcoming(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(
        await sb()
          .from('appointments')
          .select(APPOINTMENT_SELECT)
          .eq('business_id', businessId!)
          .in('status', ['requested', 'quoted', 'confirmed'])
          .gte('starts_at', new Date().toISOString())
          .order('starts_at')
          .limit(8),
      ) as unknown as AppointmentWithRelations[],
  });
}

/** Quote-required requests awaiting a price, plus quotes awaiting the client. */
export function useQuoteInbox(businessId: string | null) {
  return useQuery({
    queryKey: qk.quoteInbox(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(
        await sb()
          .from('appointments')
          .select(
            '*, service:services!appointments_service_fk!inner(id,title,duration_minutes,pricing_model,price_cents), client:profiles!appointments_client_id_fkey(id,full_name,phone), quotes:appointment_quotes(id,amount_cents,status,valid_until,created_at)',
          )
          .eq('business_id', businessId!)
          .eq('service.pricing_model', 'quote_required')
          .in('status', ['requested', 'quoted'])
          .order('starts_at'),
      ) as unknown as Array<
        AppointmentWithRelations & {
          service: { price_cents: number | null } & AppointmentWithRelations['service'];
          quotes: Array<{ id: string; amount_cents: number; status: string; valid_until: string; created_at: string }>;
        }
      >,
  });
}

export function useStaff(businessId: string | null) {
  return useQuery({
    queryKey: qk.staff(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(await sb().from('staff_members').select('*').eq('business_id', businessId!).order('created_at')),
  });
}

export function useServices(businessId: string | null) {
  return useQuery({
    queryKey: qk.services(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(await sb().from('services').select('*').eq('business_id', businessId!).order('sort_order').order('title')),
  });
}

export function useTips(businessId: string | null) {
  return useQuery({
    queryKey: qk.tips(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(
        await sb()
          .from('staff_tips')
          .select('*')
          .eq('business_id', businessId!)
          .order('created_at', { ascending: false })
          .limit(50),
      ),
  });
}

export function useStaffEarnings(businessId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: qk.earnings(businessId ?? '', from, to),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(await sb().rpc('get_staff_earnings', { p_business_id: businessId!, p_from: from, p_to: to })) as StaffEarningsRow[],
  });
}

// ------------------------------------------------------------------ realtime
/** Live calendar: any appointment change for this business refreshes views. */
export function useRealtimeAppointments(businessId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!businessId) return;
    const channel = sb()
      .channel(`business:${businessId}:appointments`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `business_id=eq.${businessId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['appointments', businessId] });
        void qc.invalidateQueries({ queryKey: ['stats', businessId] });
      })
      .subscribe();
    return () => {
      void sb().removeChannel(channel);
    };
  }, [businessId, qc]);
}

// ------------------------------------------------------------------ mutations
function useInvalidate(businessId: string | null) {
  const qc = useQueryClient();
  return (...keys: string[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k, businessId ?? ''] })));
}

export function useAppointmentActions(businessId: string | null) {
  const invalidate = useInvalidate(businessId);
  const done = () => invalidate('appointments', 'stats');

  const updateStatus = useMutation({
    mutationFn: async (v: { id: string; status: 'confirmed' | 'completed' | 'cancelled'; reason?: string }) =>
      unwrap(await sb().rpc('update_appointment_status', { p_appointment_id: v.id, p_status: v.status, p_reason: v.reason ?? null })),
    onSuccess: done,
  });
  const updateProgress = useMutation({
    mutationFn: async (v: { id: string; progress: 'en_route' | 'arrived' | 'in_progress' }) =>
      unwrap(await sb().rpc('update_job_progress', { p_appointment_id: v.id, p_progress: v.progress })),
    onSuccess: done,
  });
  const reschedule = useMutation({
    mutationFn: async (v: { id: string; startsAt: string; staffId?: string }) =>
      unwrap(await sb().rpc('reschedule_appointment', { p_appointment_id: v.id, p_starts_at: v.startsAt, p_staff_id: v.staffId ?? null })),
    onSuccess: done,
  });
  const createWalkIn = useMutation({
    mutationFn: async (v: { serviceId: string; staffId: string; startsAt: string; name: string; phone?: string; priceCents?: number }) =>
      unwrap(
        await sb().rpc('create_walk_in_appointment', {
          p_business_id: businessId!,
          p_service_id: v.serviceId,
          p_staff_id: v.staffId,
          p_starts_at: v.startsAt,
          p_walk_in_name: v.name,
          p_walk_in_phone: v.phone ?? null,
          p_price_cents: v.priceCents ?? null,
        }),
      ),
    onSuccess: done,
  });
  const submitQuote = useMutation({
    mutationFn: async (v: { appointmentId: string; amountCents: number; message?: string; validHours: number; proposedStartsAt?: string; proposedStaffId?: string }) =>
      unwrap(
        await sb().rpc('submit_quote', {
          p_appointment_id: v.appointmentId,
          p_amount_cents: v.amountCents,
          p_message: v.message ?? null,
          p_valid_hours: v.validHours,
          p_proposed_starts_at: v.proposedStartsAt ?? null,
          p_proposed_staff_id: v.proposedStaffId ?? null,
        }),
      ),
    onSuccess: done,
  });

  return { updateStatus, updateProgress, reschedule, createWalkIn, submitQuote };
}
