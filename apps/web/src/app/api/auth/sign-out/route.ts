import { createSupabaseServerClient } from '@/lib/supabase/server';
import { jsonOk } from '@/lib/server/api';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  // scope 'local' revokes this device's refresh token; use 'global' for "sign out everywhere".
  await supabase.auth.signOut({ scope: 'local' });
  return jsonOk({ ok: true });
}
