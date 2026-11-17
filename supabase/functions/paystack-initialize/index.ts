/**
 * Start a payment — POST /functions/v1/paystack-initialize  (JWT required)
 *
 * Body: { appointmentId, type: 'deposit'|'balance'|'tip', tipCents?, saveCard?, paymentMethodId? }
 *
 * The amount is NEVER taken from the client: prepare_payment() derives it from
 * the appointment, applies the platform fee and creates the pending ledger row.
 * Settlement only happens in the signed webhook.
 */
import { z } from 'npm:zod@4';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { HttpError, json, log, readRawBody } from '../_shared/http.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { chargeAuthorization, initializeTransaction } from '../_shared/paystack.ts';

const bodySchema = z
  .object({
    appointmentId: z.uuid(),
    type: z.enum(['deposit', 'balance', 'tip']),
    tipCents: z.number().int().min(500).max(500_000).optional(),
    saveCard: z.boolean().default(false),
    paymentMethodId: z.uuid().optional(),
  })
  .strict()
  .refine((b) => b.type !== 'tip' || b.tipCents !== undefined, { message: 'tipCents required for tips', path: ['tipCents'] });

const prepared = z.object({
  transaction_id: z.uuid(),
  reference: z.string(),
  amount_cents: z.number().int().positive(),
  platform_fee_cents: z.number().int().nonnegative(),
  subaccount_code: z.string(),
  business_name: z.string(),
  email: z.string().email(),
});

// Map PostgREST "PTxxx" errors raised by the RPC to HTTP codes.
function rpcStatus(code: string | undefined): number {
  const m = /^PT(\d{3})$/.exec(code ?? '');
  return m ? Number(m[1]) : 500;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors);

  try {
    const { user } = await requireUser(req);
    const parsed = bodySchema.safeParse(JSON.parse((await readRawBody(req, 8 * 1024)) || '{}'));
    if (!parsed.success) return json({ error: 'VALIDATION_FAILED', issues: z.flattenError(parsed.error) }, 400, cors);
    const body = parsed.data;

    const db = adminClient();
    const { data, error } = await db.rpc('prepare_payment', {
      p_client_id: user.id,
      p_appointment_id: body.appointmentId,
      p_type: body.type,
      p_tip_cents: body.tipCents ?? null,
      p_provider: 'paystack',
    });
    if (error) return json({ error: error.message }, rpcStatus(error.code), cors);
    const payment = prepared.parse(data);

    const metadata = {
      transaction_id: payment.transaction_id,
      appointment_id: body.appointmentId,
      type: body.type,
      save_card: body.saveCard,
      // Shown on the Paystack receipt; no PII beyond what Paystack already holds.
      custom_fields: [{ display_name: 'Business', variable_name: 'business', value: payment.business_name }],
    };

    // One-tap payment with a saved, tokenised card.
    if (body.paymentMethodId) {
      const { data: authCode, error: authErr } = await db.rpc('get_payment_authorization', {
        p_client_id: user.id,
        p_payment_method_id: body.paymentMethodId,
      });
      if (authErr || typeof authCode !== 'string') return json({ error: 'PAYMENT_METHOD_NOT_FOUND' }, 404, cors);

      const charge = await chargeAuthorization({
        email: payment.email,
        amount: payment.amount_cents,
        authorization_code: authCode,
        reference: payment.reference,
        subaccount: payment.subaccount_code,
        transaction_charge: payment.platform_fee_cents,
        metadata,
      });
      log('info', 'paystack.charge_authorization', { reference: payment.reference, status: charge.status });
      // Final state still arrives via the signed webhook.
      return json({ mode: 'charged', reference: payment.reference, status: charge.status }, 200, cors);
    }

    const init = await initializeTransaction({
      email: payment.email,
      amount: payment.amount_cents,
      reference: payment.reference,
      subaccount: payment.subaccount_code,
      transaction_charge: payment.platform_fee_cents,
      callback_url: Deno.env.get('PAYSTACK_CALLBACK_URL') ?? 'khula://payments/complete',
      metadata,
    });

    log('info', 'paystack.initialized', { reference: payment.reference, type: body.type });
    return json(
      { mode: 'redirect', reference: init.reference, authorizationUrl: init.authorization_url, accessCode: init.access_code },
      200,
      cors,
    );
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status, cors);
    if (err instanceof SyntaxError) return json({ error: 'INVALID_JSON' }, 400, cors);
    log('error', 'paystack.initialize.failed', { message: err instanceof Error ? err.message : 'unknown' });
    return json({ error: 'INTERNAL_ERROR' }, 500, cors);
  }
});
