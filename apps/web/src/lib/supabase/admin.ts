import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@khula/shared';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/server/env';

/**
 * service_role client — BYPASSES RLS. Use only after the caller has been
 * authenticated and authorised, and only for operations that genuinely need
 * it (Auth Admin API, storage cleanup, audit writes). `server-only` makes any
 * accidental client-side import a build error.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminSupabase = ReturnType<typeof createAdminClient>;
