'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@khula/shared';
import { publicEnv } from '@/lib/env';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Browser client (anon key + user session cookie). All access is RLS-checked. */
export function getSupabaseBrowserClient() {
  client ??= createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
