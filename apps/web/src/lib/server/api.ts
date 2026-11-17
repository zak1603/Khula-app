import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, extractDbErrorCode, httpStatusForDbError, redactPII, type ErrorCode } from '@khula/shared';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

const MAX_JSON_BYTES = 32 * 1024;

export function jsonError(code: ErrorCode, status: number, extra?: { fields?: Record<string, string[]>; headers?: Record<string, string>; retryAfterSeconds?: number }) {
  return NextResponse.json(apiError(code, extra?.fields, extra?.retryAfterSeconds), {
    status,
    headers: { 'Cache-Control': 'no-store', ...extra?.headers },
  });
}

export function jsonOk<T>(data: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/**
 * Parses + validates a JSON body with a size cap. Unknown keys are rejected by
 * the `.strict()` schemas. Validation errors return field messages only —
 * submitted values are never echoed back.
 */
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return { ok: false, response: jsonError('UNSUPPORTED_MEDIA_TYPE', 415) };
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return { ok: false, response: jsonError('PAYLOAD_TOO_LARGE', 413) };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError('VALIDATION_FAILED', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return { ok: false, response: jsonError('VALIDATION_FAILED', 422, { fields: flat.fieldErrors as Record<string, string[]> }) };
  }
  return { ok: true, data: parsed.data };
}

/** Maps a PostgREST/RPC error to a safe API error (raw DB text is never returned). */
export function dbError(error: { code?: string; message?: string } | null) {
  const code = extractDbErrorCode(error?.message);
  const status = httpStatusForDbError(error?.code);
  if (status >= 500) logServer('error', 'db.error', { code: error?.code, message: error?.message });
  return jsonError(code, status);
}

export async function enforceLimit(bucket: Parameters<typeof checkRateLimit>[0], key: string) {
  const rl = await checkRateLimit(bucket, key);
  if (!rl.limited) return null;
  const headers = rateLimitHeaders(rl);
  return jsonError('RATE_LIMITED', 429, { headers, retryAfterSeconds: Number(headers['Retry-After'] ?? 60) });
}

/** Structured logs with PII deep-redacted (POPIA s19). */
export function logServer(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...redactPII(fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
