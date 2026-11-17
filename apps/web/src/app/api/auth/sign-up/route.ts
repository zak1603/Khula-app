import { POPIA_CONSENT_VERSION, signUpSchema } from '@khula/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { jsonError, jsonOk, logServer, parseJson } from '@/lib/server/api';

export async function POST(request: Request) {
  const body = await parseJson(request, signUpSchema);
  if (!body.ok) return body.response;
  const d = body.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: d.email,
    password: d.password,
    options: {
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      // Read by public.handle_new_user(); role is whitelisted server-side.
      data: {
        full_name: d.fullName,
        phone: d.phone,
        account_type: d.accountType,
        popia_consent: true,
        popia_consent_version: POPIA_CONSENT_VERSION,
        marketing_opt_in: d.marketingOptIn,
      },
    },
  });

  if (error) {
    if (error.code === 'weak_password') return jsonError('WEAK_PASSWORD', 422, { fields: { password: [error.message] } });
    logServer('warn', 'auth.sign_up_failed', { code: error.code });
    // Generic: never reveal whether the email is already registered.
    return jsonError('SIGN_UP_FAILED', 400);
  }

  // With email confirmations on, Supabase returns an obfuscated user for
  // existing emails — the response is identical either way (anti-enumeration).
  return jsonOk({ userId: data.user?.id ?? null, emailConfirmationRequired: !data.session }, 201);
}
