// Minimal, typed Paystack REST client (https://paystack.com/docs/api).
import { z } from 'npm:zod@4';
import { requireEnv } from './supabase.ts';
import { HttpError, log } from './http.ts';

const BASE = 'https://api.paystack.co';

/** Paystack webhook source IPs (https://paystack.com/docs/payments/webhooks). */
export const PAYSTACK_WEBHOOK_IPS = new Set(['52.31.139.75', '52.49.173.169', '52.214.14.220']);

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ status: z.boolean(), message: z.string(), data: data.optional() });

async function call<T extends z.ZodType>(
  method: 'GET' | 'POST',
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${requireEnv('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = envelope(schema).safeParse(await res.json().catch(() => ({})));
    if (!res.ok || !parsed.success || !parsed.data.status || parsed.data.data === undefined) {
      log('warn', 'paystack.api_error', { path: path.split('?')[0], http: res.status });
      throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR');
    }
    return parsed.data.data;
  } finally {
    clearTimeout(timeout);
  }
}

export const authorizationSchema = z
  .object({
    authorization_code: z.string().optional(),
    reusable: z.boolean().optional(),
    signature: z.string().optional(),
    card_type: z.string().optional(),
    last4: z.string().optional(),
    exp_month: z.string().optional(),
    exp_year: z.string().optional(),
    bank: z.string().nullable().optional(),
  })
  .passthrough();

export const verifiedTransactionSchema = z.object({
  id: z.number(),
  status: z.string(),
  reference: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  paid_at: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  fees: z.number().nullable().optional(),
  authorization: authorizationSchema.nullable().optional(),
});

export function verifyTransaction(reference: string) {
  return call('GET', `/transaction/verify/${encodeURIComponent(reference)}`, verifiedTransactionSchema);
}

export function initializeTransaction(params: {
  email: string;
  amount: number; // cents
  reference: string;
  subaccount: string;
  transaction_charge: number; // flat platform fee in cents (Paystack "subaccount" split)
  callback_url: string;
  metadata: Record<string, unknown>;
}) {
  return call(
    'POST',
    '/transaction/initialize',
    z.object({ authorization_url: z.string().url(), access_code: z.string(), reference: z.string() }),
    { ...params, currency: 'ZAR', bearer: 'subaccount', channels: ['card', 'eft', 'bank_transfer', 'apple_pay'] },
  );
}

export function chargeAuthorization(params: {
  email: string;
  amount: number;
  authorization_code: string;
  reference: string;
  subaccount: string;
  transaction_charge: number;
  metadata: Record<string, unknown>;
}) {
  return call(
    'POST',
    '/transaction/charge_authorization',
    z.object({ status: z.string(), reference: z.string() }).passthrough(),
    { ...params, currency: 'ZAR', bearer: 'subaccount' },
  );
}

export function createRefund(reference: string, amountCents?: number) {
  return call(
    'POST',
    '/refund',
    z.object({ status: z.string() }).passthrough(),
    { transaction: reference, ...(amountCents ? { amount: amountCents } : {}) },
  );
}

export function listBanks() {
  return call(
    'GET',
    '/bank?country=south%20africa&perPage=100',
    z.array(z.object({ name: z.string(), code: z.string(), active: z.boolean().optional() })),
  );
}

export function createSubaccount(params: {
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  primary_contact_email?: string;
}) {
  return call(
    'POST',
    '/subaccount',
    z.object({ subaccount_code: z.string(), settlement_bank: z.string().optional() }).passthrough(),
    params,
  );
}
