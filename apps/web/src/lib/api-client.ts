'use client';

import { KhulaApiError, messageForCode, type ApiError } from '@khula/shared';

/** Same-origin JSON POST to our route handlers; throws KhulaApiError on failure. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    const code = data?.error?.code ?? 'INTERNAL_ERROR';
    throw new KhulaApiError(res.status, code, data?.error?.message ?? messageForCode(code), data?.error?.fields);
  }
  return data as T;
}
