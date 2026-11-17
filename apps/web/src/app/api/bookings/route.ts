/**
 * POST /api/bookings — create a booking (web + mobile).
 *
 * Layers: middleware IP limit → auth → Zod → per-user limit → book_appointment()
 * RPC (server-side pricing, travel-radius check, exclusion-constraint
 * double-booking guard, DB-level spam throttles, idempotency).
 */
import { createBookingSchema, type CreateBookingResponse } from '@khula/shared';
import { getRequestAuth } from '@/lib/supabase/server';
import { dbError, enforceLimit, jsonError, jsonOk, logServer, parseJson } from '@/lib/server/api';

export async function POST(request: Request) {
  const { supabase, user, channel } = await getRequestAuth(request);
  if (!user) return jsonError('AUTH_REQUIRED', 401);

  const limited = await enforceLimit('bookingUser', user.id);
  if (limited) return limited;

  const body = await parseJson(request, createBookingSchema);
  if (!body.ok) return body.response;
  const b = body.data;

  const { data: appointment, error } = await supabase.rpc('book_appointment', {
    p_service_id: b.serviceId,
    p_starts_at: b.startsAt,
    p_staff_id: b.staffId ?? null,
    p_address: b.address
      ? { line1: b.address.line1, line2: b.address.line2 ?? null, suburb: b.address.suburb, city: b.address.city, postal_code: b.address.postalCode, lat: b.address.lat, lng: b.address.lng }
      : null,
    p_client_message: b.message ?? null,
    p_idempotency_key: b.idempotencyKey,
    p_source: channel === 'mobile' ? 'app' : 'web',
  });

  if (error || !appointment) return dbError(error);

  logServer('info', 'booking.created', { appointmentId: appointment.id, status: appointment.status, channel });

  const res: CreateBookingResponse = {
    appointment,
    paymentRequired: appointment.deposit_status === 'pending',
    holdExpiresAt: appointment.hold_expires_at,
  };
  return jsonOk(res, 201);
}
