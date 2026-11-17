/**
 * PayFast Instant Transaction Notification — POST /functions/v1/payfast-itn
 *
 * Secondary South African rail (EFT-heavy customers, Instant EFT, SnapScan).
 * Implements PayFast's four mandatory ITN checks:
 *   1. Signature  — MD5(param string + passphrase) matches `signature`
 *   2. Source     — server-to-server POST back to /eng/query/validate returns VALID
 *   3. Amount     — amount_gross equals our ledger amount (re-checked in SQL)
 *   4. Merchant   — merchant_id equals ours
 *
 * Settlement reuses the same atomic, idempotent apply_payment_success() RPC
 * as Paystack, so booking state is provider-agnostic.
 */
import { crypto as stdCrypto } from 'jsr:@std/crypto@1';
import { adminClient, requireEnv } from '../_shared/supabase.ts';
import { HttpError, json, log, readRawBody } from '../_shared/http.ts';
import { bytesToHex, sha256Hex, timingSafeEqual } from '../_shared/crypto.ts';

const MAX_BODY_BYTES = 16 * 1024;

/** PHP urlencode()-compatible encoding (what PayFast signs with). */
function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

async function md5Hex(input: string): Promise<string> {
  return bytesToHex(await stdCrypto.subtle.digest('MD5', new TextEncoder().encode(input)));
}

function centsFromRand(amount: string | null): number | null {
  if (!amount || !/^-?\d+(\.\d{1,2})?$/.test(amount)) return null;
  const [rand, cents = ''] = amount.replace('-', '').split('.');
  const value = Number(rand) * 100 + Number(cents.padEnd(2, '0'));
  return amount.startsWith('-') ? -value : value;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let raw: string;
  try {
    raw = await readRawBody(req, MAX_BODY_BYTES);
  } catch (e) {
    return json({ error: 'BAD_BODY' }, e instanceof HttpError ? e.status : 400);
  }

  const params = new URLSearchParams(raw);
  const received = params.get('signature') ?? '';

  // 1. Signature over all fields in RECEIVED order, excluding `signature`.
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'signature') continue;
    pairs.push(`${key}=${phpUrlEncode(value.trim())}`);
  }
  const paramString = pairs.join('&');
  const passphrase = Deno.env.get('PAYFAST_PASSPHRASE');
  const expected = await md5Hex(passphrase ? `${paramString}&passphrase=${phpUrlEncode(passphrase.trim())}` : paramString);
  if (!/^[a-f0-9]{32}$/i.test(received) || !timingSafeEqual(expected, received.toLowerCase())) {
    log('warn', 'payfast.itn.bad_signature');
    return json({ error: 'INVALID_SIGNATURE' }, 401);
  }

  // 4. Merchant
  if (params.get('merchant_id') !== requireEnv('PAYFAST_MERCHANT_ID')) {
    log('warn', 'payfast.itn.wrong_merchant');
    return json({ error: 'INVALID_MERCHANT' }, 400);
  }

  // 2. Confirm with PayFast directly.
  const host = Deno.env.get('PAYFAST_SANDBOX') === 'true' ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
  const validate = await fetch(`https://${host}/eng/query/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: paramString,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!validate || (await validate.text()).trim() !== 'VALID') {
    log('warn', 'payfast.itn.validate_failed');
    return json({ error: 'TEMPORARY_FAILURE' }, 500); // PayFast retries
  }

  const reference = params.get('m_payment_id') ?? '';
  const status = params.get('payment_status');
  const amountCents = centsFromRand(params.get('amount_gross'));
  const feeCents = centsFromRand(params.get('amount_fee'));
  const payloadHash = await sha256Hex(raw);

  if (!/^KH-[A-Z0-9-]{8,64}$/.test(reference) || amountCents === null) {
    return json({ error: 'MALFORMED_ITN' }, 400);
  }

  const db = adminClient();
  const eventKey = `itn:${params.get('pf_payment_id') ?? payloadHash}:${status}`;
  const { error: dupErr } = await db
    .from('webhook_events')
    .insert({ provider: 'payfast', event_key: eventKey, event_type: `itn.${status ?? 'unknown'}`, payload_sha256: payloadHash });
  if (dupErr?.code === '23505') return json({ received: true, duplicate: true });

  if (status !== 'COMPLETE') {
    await db.from('webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() })
      .eq('provider', 'payfast').eq('event_key', eventKey);
    return json({ received: true });
  }

  // 3. Amount check happens atomically inside the RPC against our ledger.
  const { data, error } = await db.rpc('apply_payment_success', {
    p_provider: 'payfast',
    p_reference: reference,
    p_provider_transaction_id: params.get('pf_payment_id'),
    p_amount_cents: amountCents,
    p_currency: 'ZAR',
    p_paid_at: new Date().toISOString(),
    p_channel: 'payfast',
    p_provider_fee_cents: feeCents === null ? null : Math.abs(feeCents),
    p_payload_sha256: payloadHash,
    p_authorization: null,
    p_save_card: false,
  });

  await db
    .from('webhook_events')
    .update({ status: error ? 'failed' : 'processed', processed_at: new Date().toISOString(), last_error: error?.message?.slice(0, 500) ?? null })
    .eq('provider', 'payfast')
    .eq('event_key', eventKey);

  if (error) {
    log('error', 'payfast.itn.apply_failed', { code: error.code });
    return json({ error: 'TEMPORARY_FAILURE' }, 500);
  }
  log('info', 'payfast.itn.applied', { reference, outcome: (data as { outcome?: string })?.outcome });
  return json({ received: true });
});
