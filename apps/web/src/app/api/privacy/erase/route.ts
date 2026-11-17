/**
 * POST /api/privacy/erase — POPIA s24 self-service erasure.
 * Requires re-authentication with the account password (step-up) so a stolen
 * session alone cannot destroy an account.
 */
import { createClient } from '@supabase/supabase-js';
import { eraseAccountSchema, type Database } from '@khula/shared';
import { getRequestAuth } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';
import { anonymizeClient } from '@/lib/server/popia';
import { dbError, enforceLimit, jsonError, jsonOk, parseJson } from '@/lib/server/api';

export async function POST(request: Request) {
  const { supabase, user } = await getRequestAuth(request);
  if (!user?.email) return jsonError('AUTH_REQUIRED', 401);

  const limited = await enforceLimit('privacy', `erase:${user.id}`);
  if (limited) return limited;

  const body = await parseJson(request, eraseAccountSchema);
  if (!body.ok) return body.response;

  // Step-up verification on an isolated, non-persisting client.
  const verifier = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: pwError } = await verifier.auth.signInWithPassword({ email: user.email, password: body.data.password });
  if (pwError) return jsonError('INVALID_CREDENTIALS', 401);
  await verifier.auth.signOut({ scope: 'local' });

  const result = await anonymizeClient({
    userClient: supabase,
    admin: createAdminClient(),
    clientId: user.id,
    reason: body.data.reason ?? 'Self-service erasure request',
    actorId: user.id,
  });
  if (!result.ok) return dbError(result.error);

  await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
  return jsonOk({ erased: true, summary: result.summary });
}
