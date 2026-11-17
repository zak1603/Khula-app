-- =============================================================================
-- Khula — 0500 POPIA compliance (Protection of Personal Information Act, 2013)
--
--   s11  Consent recorded on profile (popia_consent_at / _version)
--   s14  Retention limitation  -> purge_expired_personal_data()
--   s19  Security safeguards   -> RLS, encryption, hash-chained audit_logs
--   s23  Right of access       -> export_client_data()
--   s24  Correction / deletion -> anonymize_client()
--
-- Financial records are RETAINED (Tax Administration Act s29: 5 years) but
-- de-linked from identity: the profile is anonymised, the ledger keeps the
-- pseudonymous UUID only.
-- =============================================================================

create or replace function public.anonymize_client(
  p_client_id uuid,
  p_reason    text,
  p_force     boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_is_admin       boolean := public.is_admin();
  v_self           boolean := v_uid is not null and v_uid = p_client_id;
  v_future         integer;
  v_appointments   integer;
  v_notes          integer;
  v_cards          integer;
begin
  if not (v_self or v_is_admin or public.is_service_role()) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_force and not (v_is_admin or public.is_service_role()) then
    raise exception 'FORCE_REQUIRES_ADMIN' using errcode = 'PT403';
  end if;
  if exists (select 1 from public.businesses where owner_id = p_client_id and is_active) then
    raise exception 'DEACTIVATE_OWNED_BUSINESSES_FIRST' using errcode = 'PT409';
  end if;

  select count(*) into v_future
  from public.appointments
  where client_id = p_client_id
    and status in ('requested', 'quoted', 'confirmed')
    and starts_at > now();

  if v_future > 0 and not p_force then
    raise exception 'ACTIVE_BOOKINGS_EXIST' using errcode = 'PT409',
      hint = 'Cancel upcoming bookings first, or an admin may force erasure.';
  end if;

  if v_future > 0 then
    -- Never keep money for a booking we cancel on the client's behalf.
    update public.transactions t
       set requires_refund = true
      from public.appointments a
     where t.appointment_id = a.id
       and a.client_id = p_client_id
       and a.status in ('requested', 'quoted', 'confirmed')
       and a.starts_at > now()
       and t.type in ('deposit', 'balance')
       and t.status = 'success';

    update public.appointments
       set status = 'cancelled',
           cancellation_reason = 'Account erased (POPIA s24)',
           cancelled_by = v_uid,
           deposit_status = case when deposit_status = 'paid' then 'refunded'::public.deposit_status else deposit_status end
     where client_id = p_client_id
       and status in ('requested', 'quoted', 'confirmed')
       and starts_at > now();
  end if;

  update public.profiles
     set full_name = null,
         phone = null,
         avatar_url = null,
         preference_notes = null,
         marketing_opt_in = false,
         anonymized_at = now()
   where id = p_client_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'PT404';
  end if;

  update public.appointments
     set client_address_line1 = null,
         client_address_line2 = null,
         client_suburb = null,
         client_city = null,
         client_postal_code = null,
         client_location = null,
         client_message = null
   where client_id = p_client_id;
  get diagnostics v_appointments = row_count;

  delete from public.client_notes where client_id = p_client_id;
  get diagnostics v_notes = row_count;

  delete from public.payment_methods where client_id = p_client_id;
  get diagnostics v_cards = row_count;

  update public.transactions
     set metadata = metadata - 'email' - 'customer' - 'customer_email'
   where client_id = p_client_id;

  update public.staff_members
     set display_name = 'Former team member', avatar_url = null, invite_email = null, is_active = false
   where profile_id = p_client_id;

  perform public.write_audit_log(
    'popia.client_anonymized', 'profile', p_client_id::text, null,
    jsonb_build_object(
      'self_service', v_self,
      'forced', p_force,
      'reason', left(coalesce(p_reason, ''), 200),
      'appointments_scrubbed', v_appointments,
      'notes_deleted', v_notes,
      'payment_methods_deleted', v_cards,
      'future_bookings_cancelled', v_future
    )
  );

  -- NOTE: auth.users (email, phone) is scrubbed by the caller through the
  -- GoTrue Admin API (soft delete) — see apps/web/src/lib/server/popia.ts.
  return jsonb_build_object(
    'client_id', p_client_id,
    'appointments_scrubbed', v_appointments,
    'notes_deleted', v_notes,
    'payment_methods_deleted', v_cards,
    'future_bookings_cancelled', v_future
  );
end;
$$;

-- Right of access (s23). Self-service returns everything held about the
-- caller. Provider-authored private notes are disclosed only through an
-- admin-handled request (s23(4) permits refusal grounds to be assessed).
create or replace function public.export_client_data(p_client_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target   uuid := coalesce(p_client_id, auth.uid());
  v_is_admin boolean := public.is_admin();
  v_result   jsonb;
begin
  if v_target is null or not (v_target = auth.uid() or v_is_admin) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'profile', (
      select to_jsonb(p) - 'id' from public.profiles p where p.id = v_target
    ),
    'email', (select u.email from auth.users u where u.id = v_target),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'business', b.name,
        'service', s.title,
        'status', a.status,
        'starts_at', a.starts_at,
        'ends_at', a.ends_at,
        'address', nullif(concat_ws(', ', a.client_address_line1, a.client_address_line2, a.client_suburb, a.client_city, a.client_postal_code), ''),
        'message', a.client_message,
        'total_price_cents', a.total_price_cents,
        'deposit_status', a.deposit_status,
        'created_at', a.created_at
      ) order by a.starts_at desc)
      from public.appointments a
      join public.businesses b on b.id = a.business_id
      join public.services s on s.id = a.service_id
      where a.client_id = v_target
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_id', q.appointment_id, 'amount_cents', q.amount_cents,
        'message', q.message, 'status', q.status, 'created_at', q.created_at))
      from public.appointment_quotes q
      join public.appointments a on a.id = q.appointment_id
      where a.client_id = v_target
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', t.reference, 'type', t.type, 'status', t.status,
        'amount_cents', t.amount_cents, 'paid_at', t.paid_at, 'channel', t.channel))
      from public.transactions t where t.client_id = v_target
    ), '[]'::jsonb),
    'saved_payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object('brand', pm.brand, 'last4', pm.last4, 'exp_month', pm.exp_month, 'exp_year', pm.exp_year))
      from public.payment_methods pm where pm.client_id = v_target
    ), '[]'::jsonb),
    'provider_notes', case when v_is_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'business', b.name,
        'created_at', n.created_at,
        'body', extensions.pgp_sym_decrypt(n.body_ciphertext, public.vault_secret('client_notes_key'))))
      from public.client_notes n
      join public.businesses b on b.id = n.business_id
      where n.client_id = v_target
    ), '[]'::jsonb) else null end
  ) into v_result;

  perform public.write_audit_log('popia.data_exported', 'profile', v_target::text, null,
    jsonb_build_object('by_admin', v_is_admin and v_target <> auth.uid()));

  return v_result;
end;
$$;

-- Retention limitation (s14) — runs nightly via pg_cron.
create or replace function public.purge_expired_personal_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_addresses integer;
  v_webhooks  integer;
  v_walkins   integer;
begin
  -- Job-site addresses are only needed to do the job (+ 90 days for disputes).
  update public.appointments
     set client_address_line1 = null,
         client_address_line2 = null,
         client_postal_code = null,
         client_location = null,
         client_message = null
   where status in ('completed', 'cancelled')
     and coalesce(completed_at, cancelled_at, ends_at) < now() - interval '90 days'
     and (client_address_line1 is not null or client_location is not null or client_message is not null);
  get diagnostics v_addresses = row_count;

  -- Walk-in contact numbers: 180 days.
  update public.appointments
     set walk_in_phone = null
   where walk_in_phone is not null
     and ends_at < now() - interval '180 days';
  get diagnostics v_walkins = row_count;

  delete from public.webhook_events where received_at < now() - interval '180 days';
  get diagnostics v_webhooks = row_count;

  perform public.write_audit_log('popia.retention_purge', 'system', null, null,
    jsonb_build_object('addresses', v_addresses, 'walk_in_phones', v_walkins, 'webhook_events', v_webhooks));

  return jsonb_build_object('addresses', v_addresses, 'walk_in_phones', v_walkins, 'webhook_events', v_webhooks);
end;
$$;

-- -----------------------------------------------------------------------------
-- Audited administrative actions
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.user_role;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = 'PT409';
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'PT404';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform public.write_audit_log('admin.role_changed', 'profile', p_user_id::text, null,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

create or replace function public.admin_set_business_verification(
  p_business_id       uuid,
  p_verified          boolean,
  p_platform_fee_bps  integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_platform_fee_bps is not null and p_platform_fee_bps not between 0 and 5000 then
    raise exception 'INVALID_FEE' using errcode = 'PT400';
  end if;
  update public.businesses
     set is_verified = p_verified,
         platform_fee_bps = coalesce(p_platform_fee_bps, platform_fee_bps)
   where id = p_business_id;
  if not found then
    raise exception 'BUSINESS_NOT_FOUND' using errcode = 'PT404';
  end if;
  perform public.write_audit_log('admin.business_verification', 'business', p_business_id::text, p_business_id,
    jsonb_build_object('verified', p_verified, 'platform_fee_bps', p_platform_fee_bps));
end;
$$;

-- Walks the hash chain and returns every link that fails verification.
-- An empty result means the audit log has not been tampered with.
create or replace function public.verify_audit_chain()
returns table (chain_seq bigint, problem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  return query
  with ordered as (
    select l.*,
           lag(l.row_hash)  over (order by l.chain_seq) as expected_prev,
           lag(l.chain_seq) over (order by l.chain_seq) as previous_seq
    from public.audit_logs l
  )
  select o.chain_seq,
         case
           when o.previous_seq is not null and o.chain_seq <> o.previous_seq + 1 then 'GAP_IN_SEQUENCE'
           when o.prev_hash is distinct from o.expected_prev then 'BROKEN_LINK'
           else 'HASH_MISMATCH'
         end
  from ordered o
  where (o.previous_seq is not null and o.chain_seq <> o.previous_seq + 1)
     or o.prev_hash is distinct from o.expected_prev
     or o.row_hash <> encode(sha256(convert_to(concat_ws('|',
          coalesce(o.prev_hash, 'GENESIS'),
          o.chain_seq::text,
          extract(epoch from o.occurred_at)::text,
          coalesce(o.actor_id::text, ''),
          coalesce(o.actor_role, ''),
          o.action,
          o.entity_type,
          coalesce(o.entity_id, ''),
          coalesce(o.business_id::text, ''),
          o.metadata::text
        ), 'UTF8')), 'hex')
  order by o.chain_seq;
end;
$$;
