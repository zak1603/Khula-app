import { signInSchema, type AuthResponse } from '@khula/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hashIdentifier } from '@/lib/rate-limit';
import { enforceLimit, jsonError, jsonOk, logServer, parseJson } from '@/lib/server/api';

export async function POST(request: Request) {
  const body = await parseJson(request, signInSchema);
  if (!body.ok) return body.response;

  // Second layer (IP limit already applied in middleware): per-account limit
  // stops distributed guessing against one email. Key is an HMAC, not the email.
  const limited = await enforceLimit('authIdentity', await hashIdentifier(body.data.email));
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(body.data);

  if (error || !data.user) {
    if (error?.code === 'email_not_confirmed') return jsonError('EMAIL_NOT_CONFIRMED', 403);
    // Identical response for unknown email vs wrong password (no account enumeration).
    logServer('warn', 'auth.sign_in_failed', { code: error?.code });
    return jsonError('INVALID_CREDENTIALS', 401);
  }

  const { data: profile } = await supabase.from('profiles').select('role, anonymized_at').eq('id', data.user.id).single();
  if (!profile || profile.anonymized_at) {
    await supabase.auth.signOut();
    return jsonError('INVALID_CREDENTIALS', 401);
  }

  const res: AuthResponse = { userId: data.user.id, role: profile.role, emailConfirmationRequired: false };
  return jsonOk(res);
}
