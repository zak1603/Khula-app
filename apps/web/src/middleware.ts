/**
 * Edge middleware — the first security layer for every request.
 *
 *   1. Rate limiting (Upstash Redis): auth brute-force, booking spam, API floods
 *   2. CSRF defence for cookie-authenticated mutations (strict Origin check)
 *   3. Supabase session refresh (rotating refresh tokens, HttpOnly cookies)
 *   4. Route protection for /dashboard
 *   5. Per-request nonce Content-Security-Policy for HTML responses
 *
 * NOTE (Next.js 16+): `middleware.ts` is renamed `proxy.ts` and runs on the
 * Node runtime. The logic below ports unchanged.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { apiError } from '@khula/shared';
import { checkRateLimit, clientIp, hashIdentifier, rateLimitHeaders } from '@/lib/rate-limit';
import { buildCsp, generateNonce } from '@/lib/security/csp';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SITE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').origin;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function bucketFor(pathname: string, method: string) {
  if (pathname.startsWith('/api/auth/') && MUTATING.has(method)) return 'auth' as const;
  if (pathname.startsWith('/api/bookings') && MUTATING.has(method)) return 'booking' as const;
  if (pathname.startsWith('/api/payments') && MUTATING.has(method)) return 'payment' as const;
  if (pathname.startsWith('/api/')) return 'api' as const;
  return null;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  const isApi = pathname.startsWith('/api/');

  // --- 1. Rate limiting -------------------------------------------------------
  const bucket = bucketFor(pathname, method);
  if (bucket) {
    const ipKey = await hashIdentifier(clientIp(request.headers));
    const rl = await checkRateLimit(bucket, ipKey);
    if (rl.limited) {
      const headers = rateLimitHeaders(rl);
      return jsonResponse(apiError('RATE_LIMITED', undefined, Number(headers['Retry-After'] ?? 60)), 429, headers);
    }
  }

  // --- 2. CSRF: cookie-authenticated mutations must come from our own origin --
  // Bearer-token requests (mobile app) carry no ambient credentials -> not CSRF-able.
  if (isApi && MUTATING.has(method) && !request.headers.get('authorization')?.startsWith('Bearer ')) {
    const origin = request.headers.get('origin');
    if (origin !== SITE_ORIGIN) {
      return jsonResponse(apiError('FORBIDDEN'), 403);
    }
  }

  // --- 3. Session refresh + 5. CSP -------------------------------------------
  const nonce = generateNonce();
  const csp = buildCsp(nonce, SUPABASE_URL);
  const forwardHeaders = () => {
    const h = new Headers(request.headers);
    h.set('x-nonce', nonce);
    h.set('content-security-policy', csp);
    return h;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: forwardHeaders() } });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: getUser() validates the JWT with Supabase Auth; never rely on
  // getSession() alone for authorisation decisions on the server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // --- 4. Route protection ----------------------------------------------------
  const redirectWithCookies = (to: URL) => {
    const redirect = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (pathname.startsWith('/dashboard') && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return redirectWithCookies(url);
  }
  if ((pathname === '/login' || pathname === '/register') && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return redirectWithCookies(url);
  }

  if (!isApi) response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
