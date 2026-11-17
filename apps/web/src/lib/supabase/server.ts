import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';
import type { Database } from '@khula/shared';
import { publicEnv } from '@/lib/env';

/** Cookie-session client for Server Components, Server Actions and Route Handlers. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Resolves the caller for API routes, supporting BOTH:
 *   - web dashboard: HttpOnly session cookie
 *   - mobile app:    `Authorization: Bearer <access_token>`
 * The user is always re-validated with Supabase Auth (getUser), never trusted
 * from an unverified JWT payload.
 */
export async function getRequestAuth(request: Request): Promise<{
  supabase: ServerSupabase;
  user: User | null;
  channel: 'web' | 'mobile';
}> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }) as unknown as ServerSupabase;
    const { data } = await supabase.auth.getUser(token);
    return { supabase, user: data.user ?? null, channel: 'mobile' };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user ?? null, channel: 'web' };
}
