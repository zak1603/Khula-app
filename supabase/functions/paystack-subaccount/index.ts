/**
 * Business payout onboarding — POST /functions/v1/paystack-subaccount  (JWT required)
 *
 * Body: { businessId, bankCode, accountNumber }
 *
 * Creates a Paystack subaccount so customer payments split automatically:
 * the platform keeps `transaction_charge`, the remainder settles to the
 * business's South African bank account.
 *
 * POPIA minimisation: the full account number is forwarded to Paystack over
 * TLS and NEVER stored by Khula — we keep only the bank name and last 4 digits.
 */
import { z } from 'npm:zod@4';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { HttpError, json, log, readRawBody } from '../_shared/http.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { createSubaccount, listBanks } from '../_shared/paystack.ts';

const bodySchema = z
  .object({
    businessId: z.uuid(),
    bankCode: z.string().regex(/^[A-Za-z0-9-]{2,20}$/),
    accountNumber: z.string().regex(/^[0-9]{6,16}$/, 'Account number must be 6–16 digits'),
  })
  .strict();

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors);

  try {
    const { user, userClient } = await requireUser(req);
    const parsed = bodySchema.safeParse(JSON.parse((await readRawBody(req, 4 * 1024)) || '{}'));
    if (!parsed.success) return json({ error: 'VALIDATION_FAILED', issues: z.flattenError(parsed.error) }, 400, cors);
    const { businessId, bankCode, accountNumber } = parsed.data;

    // Authorisation through RLS as the caller: only the owner can read this row.
    const { data: business, error } = await userClient
      .from('businesses')
      .select('id, name, owner_id, platform_fee_bps, paystack_subaccount_code')
      .eq('id', businessId)
      .maybeSingle();
    if (error || !business || business.owner_id !== user.id) return json({ error: 'BUSINESS_NOT_FOUND' }, 404, cors);
    if (business.paystack_subaccount_code) return json({ error: 'PAYOUTS_ALREADY_CONFIGURED' }, 409, cors);

    const banks = await listBanks();
    const bank = banks.find((b) => b.code === bankCode && b.active !== false);
    if (!bank) return json({ error: 'UNKNOWN_BANK' }, 400, cors);

    const sub = await createSubaccount({
      business_name: business.name,
      settlement_bank: bank.code,
      account_number: accountNumber,
      // Percentage fallback; per-transaction flat `transaction_charge` overrides it.
      percentage_charge: business.platform_fee_bps / 100,
      primary_contact_email: user.email ?? undefined,
    });

    const { error: saveErr } = await adminClient().rpc('set_business_payout_account', {
      p_business_id: business.id,
      p_subaccount_code: sub.subaccount_code,
      p_bank_name: bank.name,
      p_account_last4: accountNumber.slice(-4),
    });
    if (saveErr) throw new Error(saveErr.message);

    log('info', 'paystack.subaccount_created', { business_id: business.id });
    return json({ ok: true, bankName: bank.name, accountLast4: accountNumber.slice(-4) }, 200, cors);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status, cors);
    if (err instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400, cors);
    log('error', 'paystack.subaccount.failed', { message: err instanceof Error ? err.message : 'unknown' });
    return json({ error: 'INTERNAL_ERROR' }, 500, cors);
  }
});
