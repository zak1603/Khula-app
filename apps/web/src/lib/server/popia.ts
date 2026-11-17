import 'server-only';
import type { ServerSupabase } from '@/lib/supabase/server';
import type { AdminSupabase } from '@/lib/supabase/admin';
import { logServer } from './api';

/**
 * POPIA s24 erasure orchestration.
 *
 *   1. SQL anonymisation runs AS THE CALLER (self or admin), so the database
 *      authorises it and the audit log records the real actor.
 *   2. Storage objects (avatar) are deleted with the service role.
 *   3. The GoTrue identity is scrubbed and soft-deleted via the Admin API.
 *
 * Financial ledger rows are retained (Tax Administration Act) but are now
 * linked only to a pseudonymous UUID.
 */
export async function anonymizeClient(params: {
  userClient: ServerSupabase;
  admin: AdminSupabase;
  clientId: string;
  reason: string;
  force?: boolean;
  actorId: string;
}) {
  const { userClient, admin, clientId, reason, force = false, actorId } = params;

  const { data: summary, error } = await userClient.rpc('anonymize_client', {
    p_client_id: clientId,
    p_reason: reason,
    p_force: force,
  });
  if (error) return { ok: false as const, error };

  const { data: files } = await admin.storage.from('avatars').list(clientId, { limit: 100 });
  if (files?.length) {
    await admin.storage.from('avatars').remove(files.map((f) => `${clientId}/${f.name}`));
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(clientId, {
    email: `erased+${clientId}@khula.invalid`,
    email_confirm: true,
    user_metadata: {},
    ban_duration: '876000h', // ~100 years: identity can never sign in again
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(clientId, true); // soft delete

  if (updErr || delErr) {
    // The data is already anonymised; surface for manual follow-up.
    logServer('error', 'popia.auth_scrub_failed', { clientId, update: updErr?.message, delete: delErr?.message });
  }

  await auditAdminAction(admin, {
    action: 'popia.identity_erased',
    entityType: 'profile',
    entityId: clientId,
    metadata: { actor_id: actorId, self_service: actorId === clientId, auth_scrubbed: !updErr && !delErr },
  });

  return { ok: true as const, summary };
}

/** Append a tamper-evident audit entry for actions performed with the service role. */
export async function auditAdminAction(
  admin: AdminSupabase,
  entry: { action: string; entityType: string; entityId?: string | null; businessId?: string | null; metadata?: Record<string, unknown> },
) {
  const { error } = await admin.rpc('write_audit_log', {
    p_action: entry.action,
    p_entity_type: entry.entityType,
    p_entity_id: entry.entityId ?? null,
    p_business_id: entry.businessId ?? null,
    p_metadata: entry.metadata ?? {},
  });
  if (error) logServer('error', 'audit.write_failed', { action: entry.action, code: error.code });
}
