/**
 * Upstash Redis rate limiting — Edge-runtime compatible (used by middleware
 * and route handlers).
 *
 * Buckets
 *   auth          per IP      10 / 10 min   brute force & credential stuffing
 *   authIdentity  per email    5 / 15 min   targeted guessing across many IPs
 *   booking       per IP      30 / hour     booking spam (edge layer)
 *   bookingUser   per user    10 / hour     booking spam (identity layer)
 *   privacy       per user     5 / hour     DSAR export / erasure abuse
 *   api           per IP     120 / min      general API flood
 *
 * Failure policy: auth-related buckets FAIL CLOSED (a Redis outage must not
 * become a brute-force window); everything else fails open to keep the
 * marketplace available. The database adds its own booking throttles as a
 * final backstop (see book_appointment()).
 */
import { Ratelimit, type Duration } from '@upstash/ratelimit';
// Fetch-only client: runs identically in the Edge runtime (middleware) and Node (route handlers).
import { Redis } from '@upstash/redis/cloudflare';
import type { RateLimitBucket, RateLimitState } from '@khula/shared';

type Bucket = RateLimitBucket | 'authIdentity' | 'bookingUser' | 'privacy';

const CONFIG: Record<Bucket, { tokens: number; window: Duration; failClosed: boolean }> = {
  auth: { tokens: 10, window: '10 m', failClosed: true },
  authIdentity: { tokens: 5, window: '15 m', failClosed: true },
  booking: { tokens: 30, window: '1 h', failClosed: false },
  bookingUser: { tokens: 10, window: '1 h', failClosed: false },
  payment: { tokens: 20, window: '1 h', failClosed: false },
  privacy: { tokens: 5, window: '1 h', failClosed: true },
  api: { tokens: 120, window: '1 m', failClosed: false },
};

// Upstash's own variable names, or the KV_* names that Vercel's Upstash
// Marketplace integration injects. `||` so empty strings count as unset.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

// Per-isolate cache of already-blocked identifiers: blocked callers don't even
// cost a Redis round-trip while the block lasts.
const ephemeralCache = new Map<string, number>();

const limiters = new Map<Bucket, Ratelimit>();
function limiterFor(bucket: Bucket): Ratelimit | null {
  if (!redis) return null;
  let l = limiters.get(bucket);
  if (!l) {
    const cfg = CONFIG[bucket];
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.tokens, cfg.window),
      prefix: `khula:rl:${bucket}`,
      ephemeralCache,
      analytics: false,
      timeout: 1500,
    });
    limiters.set(bucket, l);
  }
  return l;
}

export interface RateLimitResult extends RateLimitState {
  bucket: Bucket;
  degraded: boolean;
}

export async function checkRateLimit(bucket: Bucket, identifier: string): Promise<RateLimitResult> {
  const cfg = CONFIG[bucket];
  const limiter = limiterFor(bucket);
  const isProd = process.env.NODE_ENV === 'production';

  if (!limiter) {
    // Not configured: allow in dev, enforce fail-closed buckets in production.
    const limited = isProd && cfg.failClosed;
    if (isProd) console.error(JSON.stringify({ level: 'error', event: 'ratelimit.not_configured', bucket }));
    return { bucket, limited, limit: cfg.tokens, remaining: limited ? 0 : cfg.tokens, resetAt: Date.now() + 60_000, degraded: true };
  }

  try {
    const r = await limiter.limit(identifier);
    const timedOut = r.reason === 'timeout';
    if (timedOut && cfg.failClosed) {
      return { bucket, limited: true, limit: r.limit, remaining: 0, resetAt: Date.now() + 30_000, degraded: true };
    }
    return { bucket, limited: !r.success, limit: r.limit, remaining: r.remaining, resetAt: r.reset, degraded: timedOut };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'ratelimit.error', bucket, message: (err as Error).message }));
    return {
      bucket,
      limited: cfg.failClosed,
      limit: cfg.tokens,
      remaining: cfg.failClosed ? 0 : cfg.tokens,
      resetAt: Date.now() + 30_000,
      degraded: true,
    };
  }
}

export function rateLimitHeaders(r: RateLimitState): Record<string, string> {
  const retryAfter = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(Math.max(0, r.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(r.resetAt / 1000)),
    ...(r.limited ? { 'Retry-After': String(retryAfter) } : {}),
  };
}

/**
 * Client IP. On Vercel `x-real-ip` / the first `x-forwarded-for` hop are set
 * by the platform and cannot be spoofed by the client. If you self-host
 * behind another proxy, make sure it OVERWRITES these headers.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

/** Hashes identifiers (emails, IPs) so Redis never stores raw personal data (POPIA). */
export async function hashIdentifier(value: string): Promise<string> {
  const pepper = process.env.RATE_LIMIT_PEPPER ?? 'dev-only-pepper-change-me';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value.toLowerCase()));
  return Array.from(new Uint8Array(sig).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}
