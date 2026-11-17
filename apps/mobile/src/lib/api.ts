import {
  KhulaApiError,
  extractDbErrorCode,
  httpStatusForDbError,
  messageForCode,
  type ApiError,
  type InitializePaymentRequest,
  type InitializePaymentResponse,
} from '@khula/shared';
import { supabase } from './supabase';
import { env } from './env';

/** Calls the Next.js BFF with the user's access token (Bearer — no cookies, not CSRF-able). */
export async function apiFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
    if (!res.ok) {
      const code = json?.error?.code ?? 'INTERNAL_ERROR';
      throw new KhulaApiError(res.status, code, json?.error?.message ?? messageForCode(code), json?.error?.fields);
    }
    return json as T;
  } catch (e) {
    if (e instanceof KhulaApiError) throw e;
    throw new KhulaApiError(0, 'NETWORK_ERROR', 'No connection. Check your internet and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Converts a supabase-js error into a friendly, typed error.
 * Typed from the whole response (not inferred from `data`) so TypeScript can't
 * collapse `.single()` results to `null` under React Query's contextual typing.
 */
export function unwrap<R extends { data: unknown; error: { code?: string; message?: string } | null }>(res: R): NonNullable<R['data']> {
  if (res.error) {
    const code = extractDbErrorCode(res.error.message);
    throw new KhulaApiError(httpStatusForDbError(res.error.code), code, messageForCode(code));
  }
  return res.data as NonNullable<R['data']>;
}

/** Starts a Paystack checkout via the Edge Function (amount computed server-side). */
export async function initializePayment(body: InitializePaymentRequest): Promise<InitializePaymentResponse> {
  const { data, error } = await supabase.functions.invoke<InitializePaymentResponse>('paystack-initialize', { body });
  if (error || !data) {
    let code = 'PAYMENT_PROVIDER_ERROR';
    try {
      const ctx = (error as { context?: Response } | null)?.context;
      const payload = ctx ? ((await ctx.json()) as { error?: string }) : null;
      if (payload?.error) code = extractDbErrorCode(payload.error);
    } catch {
      /* keep generic code */
    }
    throw new KhulaApiError(502, code, messageForCode(code));
  }
  return data;
}
