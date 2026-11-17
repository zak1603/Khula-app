/**
 * POPIA helpers that are safe to run anywhere (browser, RN, Node, Edge).
 * Server-only operations (erasure, export) live in apps/web/src/lib/server/popia.ts
 * and the corresponding SQL functions.
 */

/** k***@gmail.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** +27 82 *** 4567 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} *** ${digits.slice(-4)}`;
}

const PII_KEYS = new Set([
  'email', 'phone', 'full_name', 'fullname', 'name', 'walk_in_name', 'walk_in_phone',
  'address', 'address_line1', 'address_line2', 'client_address_line1', 'client_address_line2',
  'line1', 'line2', 'lat', 'lng', 'latitude', 'longitude', 'client_location', 'location',
  'password', 'confirmpassword', 'token', 'access_token', 'refresh_token', 'authorization',
  'authorization_code', 'account_number', 'accountnumber', 'id_number', 'body', 'note',
  'preference_notes', 'client_message', 'message', 'ip', 'ip_address',
]);

/**
 * Deep-redacts personal information before anything is logged or sent to
 * telemetry (POPIA s19 — appropriate technical measures).
 */
export function redactPII<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactPII(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PII_KEYS.has(k.toLowerCase().replace(/[-_]/g, '_')) || PII_KEYS.has(k.toLowerCase())
      ? '[REDACTED]'
      : redactPII(v, depth + 1);
  }
  return out as T;
}

/**
 * Pseudonymises an identifier (e.g. IP address) with a secret pepper so logs
 * can be correlated without storing the raw value. Uses WebCrypto (Node 20+,
 * browsers, Edge runtime).
 */
export async function pseudonymize(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Retention periods (days) — documented here, enforced by purge_expired_personal_data(). */
export const RETENTION_DAYS = {
  jobSiteAddress: 90,
  walkInPhone: 180,
  webhookEvents: 180,
  financialRecords: 5 * 365, // Tax Administration Act s29
} as const;
