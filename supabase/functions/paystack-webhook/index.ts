/**
 * Paystack webhook receiver — POST /functions/v1/paystack-webhook
 *
 * Security pipeline (each step fails closed):
 *   1. Method + optional source-IP allow-list
 *   2. Size-capped raw body read (signature is over the exact bytes)
 *   3. HMAC-SHA512(raw_body, PAYSTACK_SECRET_KEY) == x-paystack-signature (constant time)
 *   4. Strict Zod parse of the event envelope
 *   5. Idempotency via webhook_events (provider, event_key) unique key
 *   6. Server-to-server re-verification with GET /transaction/verify/:reference
 *   7. Atomic settlement in Postgres (amount + currency re-checked against ledger)
 *   8. Auto-refund when money arrives for a booking that no longer exists
 *
 * Paystack retries non-2xx responses, so transient failures return 500 and the
 * webhook_events row is left in 'failed' to be re-processed on retry.
 */
import { z } from 'npm:zod@4';
import { adminClient, requireEnv } from '../_shared/supabase.ts';
import { HttpError, clientIp, json, log, readRawBody } from '../_shared/http.ts';
import { sha256Hex, verifyHmac } from '../_shared/crypto.ts';
import { PAYSTACK_WEBHOOK_IPS, authorizationSchema, createRefund, verifyTransaction } from '../_shared/paystack.ts';

const MAX_BODY_BYTES = 256 * 1024;

const metadataSchema = z
  .union([
    z.object({ save_card: z.boolean().optional(), transaction_id: z.string().optional() }).passthrough(),
    z.string(), // Paystack sometimes returns metadata as a JSON string
    z.null(),
  ])
  .optional();

const chargeSuccessSchema = z.object({
  event: z.literal('charge.success'),
  data: z.object({
    id: z.number(),
    status: z.string(),
    reference: z.string().regex(/^KH-[A-Z0-9-]{8,64}$/),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    paid_at: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    fees: z.number().nullable().optional(),
    authorization: authorizationSchema.nullable().optional(),
    metadata: metadataSchema,
  }),
});

const refundSchema = z.object({
  event: z.enum(['refund.processed', 'refund.failed', 'refund.pending']),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      amount: z.number().int().optional(),
      transaction_reference: z.string().optional(),
      transaction: z.object({ reference: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
});

const envelopeSchema = z.object({ event: z.string().max(64), data: z.record(z.string(), z.unknown()) });

function parseSaveCard(meta: z.infer<typeof metadataSchema>): boolean {
  if (!meta) return false;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)?.save_card === true;
    } catch {
      return false;
    }
  }
  return meta.save_card === true;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // 1. Optional IP allow-list (enable once you've confirmed your gateway's XFF handling).
  if (Deno.env.get('PAYSTACK_ENFORCE_IP_ALLOWLIST') === 'true') {
    const ip = clientIp(req);
    if (!ip || !PAYSTACK_WEBHOOK_IPS.has(ip)) {
      log('warn', 'paystack.webhook.ip_rejected');
      return json({ error: 'FORBIDDEN' }, 403);
    }
  }

  // 2 + 3. Raw body + signature
  const signature = req.headers.get('x-paystack-signature') ?? '';
  if (!/^[a-f0-9]{128}$/i.test(signature)) return json({ error: 'INVALID_SIGNATURE' }, 401);

  let raw: string;
  try {
    raw = await readRawBody(req, MAX_BODY_BYTES);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    return json({ error: 'BAD_BODY' }, status);
  }

  const valid = await verifyHmac('SHA-512', requireEnv('PAYSTACK_SECRET_KEY'), raw, signature);
  if (!valid) {
    log('warn', 'paystack.webhook.bad_signature');
    return json({ error: 'INVALID_SIGNATURE' }, 401);
  }

  // 4. Envelope
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(raw));
  } catch {
    return json({ error: 'MALFORMED_EVENT' }, 400);
  }

  const payloadHash = await sha256Hex(raw);
  const eventId = String(envelope.data['id'] ?? envelope.data['reference'] ?? payloadHash);
  const eventKey = `${envelope.event}:${eventId}`.slice(0, 200);
  const db = adminClient();

  // 5. Idempotency
  const { data: existing } = await db
    .from('webhook_events')
    .select('id, status, attempts')
    .eq('provider', 'paystack')
    .eq('event_key', eventKey)
    .maybeSingle();

  if (existing && (existing.status === 'processed' || existing.status === 'ignored')) {
    return json({ received: true, duplicate: true });
  }

  let webhookRowId: number;
  if (existing) {
    webhookRowId = existing.id;
    await db.from('webhook_events').update({ attempts: existing.attempts + 1, status: 'received' }).eq('id', existing.id);
  } else {
    const { data: inserted, error } = await db
      .from('webhook_events')
      .insert({ provider: 'paystack', event_key: eventKey, event_type: envelope.event, payload_sha256: payloadHash })
      .select('id')
      .single();
    if (error || !inserted) {
      // Unique violation = a concurrent delivery is already handling it.
      if (error?.code === '23505') return json({ received: true, duplicate: true });
      log('error', 'paystack.webhook.store_failed', { code: error?.code });
      return json({ error: 'TEMPORARY_FAILURE' }, 500);
    }
    webhookRowId = inserted.id;
  }

  const finish = (status: 'processed' | 'ignored' | 'failed', lastError?: string) =>
    db
      .from('webhook_events')
      .update({ status, processed_at: new Date().toISOString(), last_error: lastError?.slice(0, 500) ?? null })
      .eq('id', webhookRowId);

  try {
    if (envelope.event === 'charge.success') {
      const event = chargeSuccessSchema.parse({ event: envelope.event, data: envelope.data });

      // 6. Never trust the webhook body alone: ask Paystack directly.
      const verified = await verifyTransaction(event.data.reference);
      if (verified.status !== 'success' || verified.reference !== event.data.reference) {
        log('warn', 'paystack.webhook.verify_mismatch', { reference: event.data.reference });
        await finish('ignored', 'VERIFY_STATUS_NOT_SUCCESS');
        return json({ received: true });
      }

      // 7. Atomic settlement (amount/currency re-checked against our ledger).
      const { data: result, error } = await db.rpc('apply_payment_success', {
        p_provider: 'paystack',
        p_reference: verified.reference,
        p_provider_transaction_id: String(verified.id),
        p_amount_cents: verified.amount,
        p_currency: verified.currency,
        p_paid_at: verified.paid_at ?? new Date().toISOString(),
        p_channel: verified.channel ?? null,
        p_provider_fee_cents: verified.fees ?? null,
        p_payload_sha256: payloadHash,
        p_authorization: verified.authorization ?? null,
        p_save_card: parseSaveCard(event.data.metadata),
      });
      if (error) throw new Error(`apply_payment_success: ${error.code ?? ''} ${error.message}`);

      const outcome = (result as { outcome: string; requires_refund?: boolean }) ?? { outcome: 'unknown' };
      log('info', 'paystack.webhook.charge_applied', { reference: verified.reference, outcome: outcome.outcome });

      // 8. Money for a closed booking goes straight back.
      if (outcome.requires_refund && Deno.env.get('PAYSTACK_AUTO_REFUND') !== 'false') {
        try {
          await createRefund(verified.reference);
          log('info', 'paystack.webhook.auto_refund_requested', { reference: verified.reference });
        } catch {
          log('error', 'paystack.webhook.auto_refund_failed', { reference: verified.reference });
          // transactions.requires_refund stays true -> surfaced on the admin refund queue
        }
      }

      await finish(outcome.outcome === 'unknown_reference' ? 'ignored' : 'processed');
      return json({ received: true });
    }

    if (envelope.event === 'refund.processed') {
      const event = refundSchema.parse({ event: envelope.event, data: envelope.data });
      const reference = event.data.transaction_reference ?? event.data.transaction?.reference;
      if (!reference || !event.data.amount) {
        await finish('ignored', 'REFUND_MISSING_REFERENCE');
        return json({ received: true });
      }
      const { error } = await db.rpc('apply_payment_refund', {
        p_provider: 'paystack',
        p_reference: reference,
        p_amount_cents: event.data.amount,
        p_payload_sha256: payloadHash,
      });
      if (error) throw new Error(`apply_payment_refund: ${error.code ?? ''} ${error.message}`);
      await finish('processed');
      return json({ received: true });
    }

    // Unhandled event types are acknowledged so Paystack stops retrying.
    await finish('ignored');
    return json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    log('error', 'paystack.webhook.processing_failed', { event: envelope.event, message });
    await finish('failed', message);
    // Validation errors are permanent -> 200 (stop retries); everything else -> 500 (retry).
    if (err instanceof z.ZodError) return json({ received: true, ignored: 'INVALID_EVENT_SHAPE' });
    return json({ error: 'TEMPORARY_FAILURE' }, 500);
  }
});
