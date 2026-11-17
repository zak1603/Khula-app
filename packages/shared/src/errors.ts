/**
 * Maps database/RPC error codes (raised as `PTxxx` SQLSTATEs) to safe,
 * human-friendly messages. Raw database messages are never shown to users.
 */
import type { ApiError, ErrorCode } from './types';

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  FORBIDDEN: "You don't have permission to do that.",
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  VALIDATION_FAILED: 'Please check the highlighted fields.',
  SLOT_UNAVAILABLE: 'That time was just taken — please choose another slot.',
  OUTSIDE_TRAVEL_RADIUS: "Sorry, this provider doesn't travel to your address.",
  OUTSIDE_WORKING_HOURS: "That time is outside the professional's working hours.",
  ADDRESS_REQUIRED: 'This provider comes to you — please add your address.',
  ADDRESS_INVALID: 'Please check your address details.',
  START_TIME_OUT_OF_RANGE: 'Bookings must be at least 30 minutes from now and within 90 days.',
  TOO_MANY_OPEN_REQUESTS: 'You have several pending requests. Wait for a response before booking more.',
  BOOKING_RATE_LIMITED: "You've made a lot of bookings recently. Please try again later.",
  SERVICE_NOT_FOUND: 'This service is no longer available.',
  STAFF_NOT_FOUND: 'That professional is no longer available.',
  APPOINTMENT_NOT_FOUND: "We couldn't find that booking.",
  APPOINTMENT_CLOSED: 'This booking is already closed.',
  CLIENTS_MAY_ONLY_CANCEL: 'You can only cancel this booking.',
  QUOTE_EXPIRED: 'This quote has expired. Ask the provider for a new one.',
  QUOTE_NOT_PENDING: 'This quote has already been answered.',
  HOLD_EXPIRED: 'Your reservation expired. Please book again.',
  DEPOSIT_NOT_DUE: 'No deposit is due for this booking.',
  BUSINESS_PAYOUTS_NOT_CONFIGURED: "This business can't accept online payments yet.",
  ACTIVE_BOOKINGS_EXIST: 'Cancel your upcoming bookings before deleting your account.',
  LOCATION_OUTSIDE_SOUTH_AFRICA: 'Khula is currently available in South Africa only.',
  PAYMENT_PROVIDER_ERROR: 'The payment provider is unavailable. Please try again shortly.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

export function messageForCode(code: string): string {
  return MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR!;
}

/** Extracts our UPPER_SNAKE code from a PostgREST error message. */
export function extractDbErrorCode(message: string | undefined | null): string {
  const m = /^([A-Z][A-Z0-9_]{2,60})(?::|$)/.exec(message ?? '');
  return m?.[1] ?? 'INTERNAL_ERROR';
}

/** PostgREST encodes HTTP status in SQLSTATE `PTxxx`. */
export function httpStatusForDbError(sqlState: string | undefined | null): number {
  const m = /^PT(\d{3})$/.exec(sqlState ?? '');
  if (m) return Number(m[1]);
  if (sqlState === '42501') return 403; // insufficient_privilege
  if (sqlState === '23505' || sqlState === '23P01') return 409;
  if (sqlState?.startsWith('22') || sqlState?.startsWith('23')) return 400;
  return 500;
}

export function apiError(code: ErrorCode, fields?: Record<string, string[]>, retryAfterSeconds?: number): ApiError {
  return {
    error: {
      code,
      message: messageForCode(code),
      ...(fields ? { fields } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    },
  };
}

export class KhulaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'KhulaApiError';
  }
}
