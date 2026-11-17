-- =============================================================================
-- Khula — 0400 Payments (Paystack primary, PayFast secondary)
--
-- Only service_role (Edge Functions holding provider secrets) may execute
-- these. Amounts are always computed here from the database — a client can
-- never choose what it pays.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prepare_payment: create a pending ledger row + reference for checkout.
-- -----------------------------------------------------------------------------
create or replace function public.prepare_payment(
  p_client_id       uuid,
  p_appointment_id  uuid,
  p_type            public.transaction_type,
  p_tip_cents       integer default null,
  p_provider        public.payment_provider default 'paystack'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appt      public.appointments;
  v_business  public.businesses;
  v_amount    bigint;
  v_fee       bigint := 0;
  v_paid      bigint;
  v_tx        public.transactions;
  v_email     text;
begin
  if not public.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found or v_appt.client_id is distinct from p_client_id then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  select * into v_business from public.businesses where id = v_appt.business_id;

  if p_provider = 'paystack' and v_business.paystack_subaccount_code is null then
    raise exception 'BUSINESS_PAYOUTS_NOT_CONFIGURED' using errcode = 'PT409';
  end if;

  case p_type
    when 'deposit' then
      if v_appt.deposit_status <> 'pending'
         or v_appt.status not in ('requested', 'quoted')
         or v_appt.deposit_cents <= 0 then
        raise exception 'DEPOSIT_NOT_DUE' using errcode = 'PT409';
      end if;
      if v_appt.hold_expires_at is not null and v_appt.hold_expires_at < now() then
        raise exception 'HOLD_EXPIRED' using errcode = 'PT409';
      end if;
      v_amount := v_appt.deposit_cents;
      v_fee    := round(v_amount * v_business.platform_fee_bps / 10000.0);

    when 'balance' then
      if v_appt.status not in ('confirmed', 'completed') or v_appt.total_price_cents is null then
        raise exception 'BALANCE_NOT_DUE' using errcode = 'PT409';
      end if;
      select coalesce(sum(t.amount_cents), 0) into v_paid
      from public.transactions t
      where t.appointment_id = v_appt.id and t.type in ('deposit', 'balance') and t.status = 'success';
      v_amount := v_appt.total_price_cents - v_paid;
      if v_amount <= 0 then
        raise exception 'NOTHING_OUTSTANDING' using errcode = 'PT409';
      end if;
      v_fee := round(v_amount * v_business.platform_fee_bps / 10000.0);

    when 'tip' then
      if v_appt.status <> 'completed' or v_appt.staff_id is null then
        raise exception 'TIP_NOT_ALLOWED' using errcode = 'PT409';
      end if;
      if p_tip_cents is null or p_tip_cents not between 500 and 500000 then   -- R5 .. R5 000
        raise exception 'INVALID_TIP_AMOUNT' using errcode = 'PT400';
      end if;
      v_amount := p_tip_cents;
      v_fee    := 0;   -- tips go 100% to the vendor/staff

    else
      raise exception 'UNSUPPORTED_TYPE' using errcode = 'PT400';
  end case;

  -- Any earlier pending attempt for the same purpose is superseded.
  update public.transactions
     set status = 'failed', failure_reason = 'Superseded by newer checkout'
   where appointment_id = v_appt.id and type = p_type and status = 'pending';

  insert into public.transactions (
    business_id, appointment_id, client_id, staff_id, provider, type, status,
    reference, amount_cents, platform_fee_cents, subaccount_code
  )
  values (
    v_business.id, v_appt.id, p_client_id,
    case when p_type = 'tip' then v_appt.staff_id end,
    p_provider, p_type, 'pending',
    'KH-' || upper(left(p_type::text, 3)) || '-' || upper(replace(gen_random_uuid()::text, '-', '')),
    v_amount, v_fee, v_business.paystack_subaccount_code
  )
  returning * into v_tx;

  select u.email into v_email from auth.users u where u.id = p_client_id;

  return jsonb_build_object(
    'transaction_id',     v_tx.id,
    'reference',          v_tx.reference,
    'amount_cents',       v_tx.amount_cents,
    'platform_fee_cents', v_tx.platform_fee_cents,
    'currency',           v_tx.currency,
    'subaccount_code',    v_tx.subaccount_code,
    'business_name',      v_business.name,
    'email',              v_email
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- apply_paystack_charge_success: atomic, idempotent settlement of a verified
-- charge. Called by the webhook AFTER signature + API re-verification.
-- -----------------------------------------------------------------------------
create or replace function public.apply_payment_success(
  p_provider                public.payment_provider,
  p_reference               text,
  p_provider_transaction_id text,
  p_amount_cents            bigint,
  p_currency                text,
  p_paid_at                 timestamptz,
  p_channel                 text,
  p_provider_fee_cents      bigint,
  p_payload_sha256          text,
  p_authorization           jsonb default null,   -- Paystack card authorization (for saved cards)
  p_save_card               boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tx       public.transactions;
  v_appt     public.appointments;
  v_outcome  text := 'applied';
begin
  if not public.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_tx from public.transactions
  where reference = p_reference and provider = p_provider
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_reference');
  end if;
  if v_tx.status = 'success' then
    return jsonb_build_object('outcome', 'duplicate', 'transaction_id', v_tx.id);
  end if;

  -- Amount / currency tampering check.
  if upper(coalesce(p_currency, '')) <> v_tx.currency or p_amount_cents <> v_tx.amount_cents then
    update public.transactions
       set status = 'failed',
           failure_reason = 'AMOUNT_OR_CURRENCY_MISMATCH',
           requires_refund = true,
           provider_transaction_id = p_provider_transaction_id,
           webhook_payload_sha256 = p_payload_sha256,
           signature_verified_at = now()
     where id = v_tx.id;
    perform public.write_audit_log('payments.amount_mismatch', 'transaction', v_tx.id::text, v_tx.business_id,
      jsonb_build_object('expected', v_tx.amount_cents, 'received', p_amount_cents, 'currency', p_currency));
    return jsonb_build_object('outcome', 'amount_mismatch', 'transaction_id', v_tx.id);
  end if;

  update public.transactions
     set status = 'success',
         provider_transaction_id = p_provider_transaction_id,
         paid_at = coalesce(p_paid_at, now()),
         channel = left(p_channel, 32),
         provider_fee_cents = p_provider_fee_cents,
         webhook_payload_sha256 = p_payload_sha256,
         signature_verified_at = now()
   where id = v_tx.id
  returning * into v_tx;

  if v_tx.appointment_id is not null then
    select * into v_appt from public.appointments where id = v_tx.appointment_id for update;
  end if;

  if v_tx.type = 'deposit' and v_appt.id is not null then
    if v_appt.status in ('requested', 'quoted') and v_appt.deposit_status = 'pending' then
      update public.appointments
         set deposit_status = 'paid',
             status = 'confirmed'
       where id = v_appt.id;
      insert into public.appointment_events (appointment_id, business_id, event_type, note)
      values (v_appt.id, v_appt.business_id, 'payment_received', 'Deposit received');
    else
      -- Paid after the hold lapsed / booking was cancelled: never keep the money.
      update public.transactions set requires_refund = true where id = v_tx.id;
      v_outcome := 'paid_but_booking_closed';
    end if;

  elsif v_tx.type = 'balance' and v_appt.id is not null then
    insert into public.appointment_events (appointment_id, business_id, event_type, note)
    values (v_appt.id, v_appt.business_id, 'payment_received', 'Balance received');

  elsif v_tx.type = 'tip' and v_tx.staff_id is not null then
    insert into public.staff_tips (business_id, staff_id, appointment_id, transaction_id, amount_cents, method, note, recorded_by)
    values (v_tx.business_id, v_tx.staff_id, v_tx.appointment_id, v_tx.id, v_tx.amount_cents, 'in_app', 'In-app tip', null)
    on conflict (transaction_id) do nothing;
  end if;

  -- Optional: tokenise the card for one-tap repeat payments (opt-in only).
  if p_save_card
     and v_tx.client_id is not null
     and p_authorization is not null
     and (p_authorization ->> 'reusable')::boolean is true
     and coalesce(p_authorization ->> 'authorization_code', '') ~ '^AUTH_[A-Za-z0-9]{4,64}$'
     and coalesce(p_authorization ->> 'signature', '') <> '' then
    insert into public.payment_methods (
      client_id, provider, authorization_ciphertext, card_signature,
      brand, last4, exp_month, exp_year, bank
    )
    values (
      v_tx.client_id, p_provider,
      extensions.pgp_sym_encrypt(p_authorization ->> 'authorization_code',
                                 public.vault_secret('payment_tokens_key'), 'cipher-algo=aes256'),
      left(p_authorization ->> 'signature', 128),
      left(p_authorization ->> 'card_type', 32),
      case when (p_authorization ->> 'last4') ~ '^[0-9]{4}$' then p_authorization ->> 'last4' end,
      case when (p_authorization ->> 'exp_month') ~ '^[0-9]{1,2}$' then (p_authorization ->> 'exp_month')::smallint end,
      case when (p_authorization ->> 'exp_year') ~ '^[0-9]{4}$' then (p_authorization ->> 'exp_year')::smallint end,
      left(p_authorization ->> 'bank', 80)
    )
    on conflict (client_id, provider, card_signature) do update
      set authorization_ciphertext = excluded.authorization_ciphertext,
          exp_month = excluded.exp_month,
          exp_year  = excluded.exp_year;
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'transaction_id', v_tx.id,
    'requires_refund', v_outcome <> 'applied'
  );
end;
$$;

create or replace function public.apply_payment_refund(
  p_provider        public.payment_provider,
  p_reference       text,
  p_amount_cents    bigint,
  p_payload_sha256  text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions;
begin
  if not public.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_tx from public.transactions
  where reference = p_reference and provider = p_provider
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_reference');
  end if;
  if v_tx.status = 'refunded' then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  update public.transactions
     set status = case when p_amount_cents >= v_tx.amount_cents then 'refunded'::public.transaction_status else status end,
         requires_refund = false,
         metadata = metadata || jsonb_build_object('refunded_cents', p_amount_cents, 'refund_payload_sha256', p_payload_sha256)
   where id = v_tx.id;

  if v_tx.type = 'deposit' and v_tx.appointment_id is not null then
    update public.appointments
       set deposit_status = 'refunded'
     where id = v_tx.appointment_id and deposit_status in ('paid', 'refunded');
  end if;

  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx.id);
end;
$$;

-- Decrypt a saved card token for charge_authorization. service_role only.
create or replace function public.get_payment_authorization(p_client_id uuid, p_payment_method_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  select extensions.pgp_sym_decrypt(pm.authorization_ciphertext, public.vault_secret('payment_tokens_key'))
    into v_code
  from public.payment_methods pm
  where pm.id = p_payment_method_id and pm.client_id = p_client_id;
  if v_code is null then
    raise exception 'PAYMENT_METHOD_NOT_FOUND' using errcode = 'PT404';
  end if;
  return v_code;
end;
$$;

-- Store the Paystack subaccount after the Edge Function created it.
-- The full bank account number is NEVER stored — only the last 4 digits.
create or replace function public.set_business_payout_account(
  p_business_id      uuid,
  p_subaccount_code  text,
  p_bank_name        text,
  p_account_last4    text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  update public.businesses
     set paystack_subaccount_code = p_subaccount_code,
         payout_bank_name = left(p_bank_name, 80),
         payout_account_last4 = p_account_last4
   where id = p_business_id;
  if not found then
    raise exception 'BUSINESS_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;
