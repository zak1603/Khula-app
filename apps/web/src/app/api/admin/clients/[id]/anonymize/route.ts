/** POST /api/admin/clients/:id/anonymize — admin-handled POPIA erasure (audited). */
import { z } from 'zod';
import { plainText, uuid } from '@khula/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { anonymizeClient } from '@/lib/server/popia';
import { dbError, jsonError, jsonOk, parseJson } from '@/lib/server/api';

const bodySchema = z
  .object({
    reason: plainText({ min: 5, max: 200, label: 'Reason' }), // e.g. ticket / DSAR reference
    force: z.boolean().default(false),
  })
  .strict();

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return jsonError('NOT_FOUND', 404);

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return jsonError('AUTH_REQUIRED', 401);

  // Require MFA (AAL2) for destructive admin actions.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') return jsonError('MFA_REQUIRED', 403);

  const body = await parseJson(request, bodySchema);
  if (!body.ok) return body.response;

  // The SQL function re-checks is_admin(); this early check just avoids work.
  const { data: me } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (me?.role !== 'admin') return jsonError('FORBIDDEN', 403);

  const result = await anonymizeClient({
    userClient: supabase,
    admin: createAdminClient(),
    clientId: id,
    reason: body.data.reason,
    force: body.data.force,
    actorId: auth.user.id,
  });
  if (!result.ok) return dbError(result.error);
  return jsonOk({ erased: true, summary: result.summary });
}
