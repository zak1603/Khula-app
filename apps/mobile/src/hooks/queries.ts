import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceModel } from '@khula/shared';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

const PAGE = 20;

export const mk = {
  categories: ['categories'] as const,
  search: (p: object) => ['search', p] as const,
  business: (id: string) => ['business', id] as const,
  businessServices: (id: string) => ['business', id, 'services'] as const,
  staff: (id: string) => ['business', id, 'staff'] as const,
  service: (id: string) => ['service', id] as const,
  slots: (s: string, d: string, staff: string | null) => ['slots', s, d, staff] as const,
  myBookings: ['my', 'bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  profile: ['my', 'profile'] as const,
  paymentMethods: ['my', 'payment-methods'] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: mk.categories,
    staleTime: 60 * 60_000,
    queryFn: async () => unwrap(await supabase.from('categories').select('id, slug, name, icon').order('sort_order')),
  });
}

export interface SearchParams {
  q?: string;
  category?: string;
  serviceModel?: ServiceModel;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export function useBusinessSearch(params: SearchParams) {
  return useInfiniteQuery({
    queryKey: mk.search(params),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await supabase.rpc('search_businesses', {
          p_lat: params.lat ?? null,
          p_lng: params.lng ?? null,
          p_radius_km: params.radiusKm ?? 25,
          p_category: params.category ?? null,
          p_query: params.q?.trim() || null,
          p_service_model: params.serviceModel ?? null,
          p_limit: PAGE,
          p_offset: pageParam * PAGE,
        }),
      ),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  });
}

export function useBusinessPublic(id: string | undefined) {
  return useQuery({
    queryKey: mk.business(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('get_business_public', { p_business_id: id! }))[0] ?? null,
  });
}

export function useBusinessServices(businessId: string | undefined) {
  return useQuery({
    queryKey: mk.businessServices(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('services')
          .select('id, business_id, title, description, pricing_model, price_cents, duration_minutes, deposit_percent')
          .eq('business_id', businessId!)
          .eq('is_active', true)
          .order('sort_order'),
      ),
  });
}

export function useService(id: string | undefined) {
  return useQuery({
    queryKey: mk.service(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('services')
          .select('id, business_id, title, description, pricing_model, price_cents, duration_minutes, buffer_minutes, deposit_percent')
          .eq('id', id!)
          .single(),
      ),
  });
}

export function useBookableStaff(businessId: string | undefined) {
  return useQuery({
    queryKey: mk.staff(businessId ?? ''),
    enabled: !!businessId,
    queryFn: async () => unwrap(await supabase.rpc('list_bookable_staff', { p_business_id: businessId! })),
  });
}

export function useAvailableSlots(serviceId: string | undefined, date: string, staffId: string | null) {
  return useQuery({
    queryKey: mk.slots(serviceId ?? '', date, staffId),
    enabled: !!serviceId,
    staleTime: 15_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.rpc('get_available_slots', { p_service_id: serviceId!, p_date: date, p_staff_id: staffId }),
      );
      // "Any professional": one entry per start time (server auto-assigns the lane).
      if (staffId) return rows;
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.slot_start) ? false : (seen.add(r.slot_start), true)));
    },
  });
}

export function useMyBookings() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: mk.myBookings,
    enabled: !!userId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('appointments')
          .select('*, service:services!appointments_service_fk(id,title,duration_minutes,pricing_model)')
          .eq('client_id', userId!)
          .order('starts_at', { ascending: false })
          .limit(100),
      ) as unknown as Array<
        import('@khula/shared').Appointment & { service: { id: string; title: string; duration_minutes: number; pricing_model: string } | null }
      >,
  });

  // Realtime: RLS ensures the socket only ever delivers this user's rows.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`client:${userId}:appointments`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `client_id=eq.${userId}` }, () => {
        void qc.invalidateQueries({ queryKey: mk.myBookings });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  return query;
}

export function useProfile() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: mk.profile,
    enabled: !!userId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('profiles')
          .select('id, full_name, phone, avatar_url, preference_notes, marketing_opt_in, popia_consent_at')
          .eq('id', userId!)
          .single(),
      ),
  });
}

export function usePaymentMethods() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: mk.paymentMethods,
    enabled: !!userId,
    // Explicit columns: the encrypted token column is not even selectable (column grants).
    queryFn: async () =>
      unwrap(
        await supabase
          .from('payment_methods')
          .select('id, brand, last4, exp_month, exp_year, bank, is_default, created_at')
          .order('created_at', { ascending: false }),
      ),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('payment_methods').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: mk.paymentMethods }),
  });
  return { ...query, remove };
}
